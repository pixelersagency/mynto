import {
  db,
  pgErrorCode,
  type DashboardAuditRef,
  type DashboardRefreshResult,
  type DeletedAudit,
} from '@mynto/db';
import { getMediaStorage } from '@mynto/db/media';
import {
  AuditFullCreateRequestSchema,
  type AuditFullFinding,
  type AuditFullResult,
} from '@mynto/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config, publicBaseUrl } from '../config.js';
import { requireInternalToken } from '../lib/internal-auth.js';
import { modulesForNewAudit, modulesOfAudit } from '../lib/modules.js';
import { decideRefresh } from '../lib/radar/refresh.js';
import { generateTrackingToken, trackingUrl } from '../lib/radar/tokens.js';
import { SLUG_PATTERN, generateSlug } from '../lib/slug.js';
import { checkUrlSafe, extractDomain, normalizeUrl } from '../lib/url-guard.js';
import { logger } from '../logger.js';
import { generateFullAuditPdf } from '../pdf/pdf-generator.js';
import { enqueueFullAudit } from '../queue/full-audit-queue.js';

const SlugParamsSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN),
});

const AuditIdParamsSchema = z.object({
  id: z.string().uuid(),
});

const RADAR_AUDIT_EXPIRY_DAYS = 180;

const SOURCES = ['web', 'radar', 'dashboard', 'api', 'mcp'] as const;
/** A refresh keeps the source of the scan it replaces. */
function refreshSource(source: string): (typeof SOURCES)[number] {
  return (SOURCES as readonly string[]).includes(source)
    ? (source as (typeof SOURCES)[number])
    : 'dashboard';
}
const DAY_MS = 24 * 3600 * 1000;

/**
 * Routes for the multi-axis audit (axes and collectors per audit modules).
 *
 *   POST   /api/audits/full                 start an audit + its tracking link   (internal token)
 *   POST   /api/audits/full/:id/refresh     rescan, same public links            (internal token)
 *   DELETE /api/audits/full/:id             delete an audit and its media        (internal token)
 *   GET    /api/audits/full/:slug           report (non-PII columns)             public
 *   GET    /api/audits/full/:slug/findings  findings for the report              public
 *   GET    /api/audits/full/:slug/pdf       PDF export of the report             public
 *
 * Write routes are only called by the web dashboard (server side), with
 * SCANNER_INTERNAL_TOKEN in `x-internal-token`. Tracking tokens are bearer
 * secrets of the /r/<token> reports: never logged.
 */
export function registerAuditsFullRoutes(app: FastifyInstance): void {
  app.post(
    '/api/audits/full',
    {
      config: {
        rateLimit: {
          max: config.RATE_LIMIT_AUDITS_PER_IP_PER_HOUR,
          timeWindow: '1 hour',
        },
      },
    },
    async (req, reply) => {
      if (!requireInternalToken(req, reply)) return reply;
      const parsed = AuditFullCreateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request', details: parsed.error.issues });
      }
      const { url, email, label, source } = parsed.data;

      const normalized = normalizeUrl(url);
      if (normalized === null) {
        return reply.code(400).send({ error: 'invalid_url' });
      }
      const domain = extractDomain(normalized);
      if (!domain) {
        return reply.code(400).send({ error: 'invalid_url' });
      }

      const safety = await checkUrlSafe(normalized);
      if (!safety.ok) {
        logger.warn({ reason: safety.reason, domain }, 'full_audit_rejected_unsafe_url');
        return reply.code(400).send({ error: 'unsafe_url', reason: safety.reason });
      }

      const slug = generateSlug();
      const modules = await modulesForNewAudit(parsed.data.modules);

      let created: { auditId: string; trackingToken: string };
      try {
        created = await db().dashboard.createAuditWithLink(
          {
            slug,
            url: normalized,
            email: email ?? null,
            label: label ?? null,
            status: 'queued',
            source: source ?? 'dashboard',
            modules,
          },
          { domain, trackingToken: generateTrackingToken() },
        );
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'full_audit_insert_failed');
        return reply.code(500).send({ error: 'insert_failed' });
      }

      try {
        await enqueueFullAudit({ auditId: created.auditId, slug, url: normalized });
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : 'unknown' },
          'full_audit_enqueue_failed',
        );
        await db()
          .audits.finish(created.auditId, { status: 'failed', llm_error: 'enqueue_failed' })
          .catch((e: unknown) => {
            logger.error({ code: pgErrorCode(e) }, 'full_audit_mark_failed_failed');
          });
        return reply.code(503).send({ error: 'queue_unavailable' });
      }

      logger.info({ slug, domain, source: source ?? 'dashboard' }, 'full_audit_queued');
      return reply.code(202).send({
        id: created.auditId,
        slug,
        status: 'queued',
        modules,
        tracking_token: created.trackingToken,
        tracking_url: trackingUrl(publicBaseUrl(), created.trackingToken),
      });
    },
  );

  // Rescan an audit, keeping its public links (/r/<token> repointed to the
  // new scan, like the Radar refresh). Radar audits keep their deferred
  // narrative mode and 180-day expiry.
  app.post(
    '/api/audits/full/:id/refresh',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!requireInternalToken(req, reply)) return reply;
      const params = AuditIdParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(404).send({ error: 'not_found' });

      let current: DashboardAuditRef | null;
      try {
        current = await db().dashboard.getAudit(params.data.id);
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'full_audit_refresh_lookup_failed');
        return reply.code(500).send({ error: 'fetch_failed' });
      }
      if (current === null) return reply.code(404).send({ error: 'not_found' });
      if (current.replaced_by !== null) {
        return reply.code(409).send({ error: 'replaced', id: current.replaced_by });
      }
      const decision = decideRefresh(
        { status: current.status, createdAt: current.created_at },
        new Date(),
        0,
      );
      if (decision === 'in_progress') {
        return reply.code(200).send({ id: current.id, refreshed: false, reason: 'in_progress' });
      }

      const radar = current.source === 'radar';
      const slug = generateSlug();
      let refreshed: DashboardRefreshResult;
      try {
        refreshed = await db().dashboard.refreshAudit(current.id, {
          slug,
          url: current.url,
          email: null,
          label: current.label,
          status: 'queued',
          source: refreshSource(current.source),
          modules: await modulesOfAudit(current.id),
          llmStatus: radar ? 'pending' : null,
          ...(radar
            ? { expiresAt: new Date(Date.now() + RADAR_AUDIT_EXPIRY_DAYS * DAY_MS).toISOString() }
            : {}),
        });
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'full_audit_refresh_failed');
        return reply.code(500).send({ error: 'refresh_failed' });
      }
      if (refreshed.kind === 'in_progress') {
        return reply.code(200).send({ id: current.id, refreshed: false, reason: 'in_progress' });
      }

      try {
        await enqueueFullAudit({ auditId: refreshed.newAuditId, slug, url: current.url, radar });
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : 'unknown' },
          'full_audit_refresh_enqueue_failed',
        );
        await db()
          .radar.undoRefresh(current.id, refreshed.newAuditId)
          .catch((e: unknown) => {
            logger.error({ code: pgErrorCode(e) }, 'full_audit_refresh_undo_failed');
          });
        return reply.code(503).send({ error: 'queue_unavailable' });
      }

      logger.info({ slug }, 'full_audit_refreshed');
      return reply.code(202).send({ id: refreshed.newAuditId, slug, refreshed: true });
    },
  );

  app.delete(
    '/api/audits/full/:id',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    async (req, reply) => {
      if (!requireInternalToken(req, reply)) return reply;
      const params = AuditIdParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(404).send({ error: 'not_found' });

      let deleted: DeletedAudit[];
      try {
        deleted = await db().dashboard.deleteAudit(params.data.id);
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'full_audit_delete_failed');
        return reply.code(500).send({ error: 'delete_failed' });
      }
      if (deleted.length === 0) return reply.code(404).send({ error: 'not_found' });

      // Best-effort: an orphan file is harmless (UUID name, never listed).
      const media = getMediaStorage();
      await Promise.all(
        deleted
          .flatMap((d) => [d.hero_screenshot_key, d.favicon_key])
          .filter((k): k is string => k !== null)
          .map((k) =>
            media.delete(k).catch((err: unknown) => {
              logger.warn(
                { err: err instanceof Error ? err.message : 'unknown' },
                'full_audit_hero_delete_failed',
              );
            }),
          ),
      );

      logger.info({ count: deleted.length }, 'full_audit_deleted');
      return reply.code(200).send({ deleted: deleted.length });
    },
  );

  app.get('/api/audits/full/:slug', async (req, reply) => {
    const parsed = SlugParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_slug' });
    }

    let data: AuditFullResult | null;
    try {
      data = await db().audits.getPublicBySlug(parsed.data.slug, 'summary');
    } catch (err) {
      logger.error({ code: pgErrorCode(err), slug: parsed.data.slug }, 'full_audit_fetch_failed');
      return reply.code(500).send({ error: 'fetch_failed' });
    }
    if (!data) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send(data);
  });

  app.get(
    '/api/audits/full/:slug/pdf',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (req, reply) => {
      const parsed = SlugParamsSchema.safeParse(req.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_slug' });
      }

      let a: { slug: string; status: string } | null;
      try {
        a = await db().audits.getPublicStatusBySlug(parsed.data.slug);
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'full_audit_pdf_lookup_failed');
        return reply.code(500).send({ error: 'fetch_failed' });
      }
      if (!a) {
        return reply.code(404).send({ error: 'not_found' });
      }
      if (a.status !== 'completed') {
        return reply.code(409).send({ error: 'not_ready', status: a.status });
      }

      const buffer = await generateFullAuditPdf(a.slug);
      if (!buffer) {
        logger.error({ slug: a.slug }, 'full_audit_pdf_generation_failed');
        return reply.code(500).send({ error: 'pdf_generation_failed' });
      }

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="audit-mynto-${a.slug}.pdf"`);
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.send(buffer);
    },
  );

  app.get('/api/audits/full/:slug/findings', async (req, reply) => {
    const parsed = SlugParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_slug' });
    }

    let findings: AuditFullFinding[] | null;
    try {
      findings = await db().audits.listPublicFindingsBySlug(parsed.data.slug);
    } catch (err) {
      logger.error({ code: pgErrorCode(err) }, 'full_audit_findings_fetch_failed');
      return reply.code(500).send({ error: 'fetch_failed' });
    }
    if (findings === null) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.send({ findings });
  });
}
