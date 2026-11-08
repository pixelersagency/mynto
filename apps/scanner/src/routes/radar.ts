import { db, isUniqueViolation, pgErrorCode, type RefreshResult } from '@mynto/db';
import { RadarCreateAuditRequestSchema } from '@mynto/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { config, publicBaseUrl } from '../config.js';
import { rateLimitKey } from '../lib/client-ip.js';
import { modulesForNewAudit, modulesOfAudit } from '../lib/modules.js';
import { pickReusableAudit, type CacheCandidate } from '../lib/radar/cache.js';
import { releaseQuotaSlot, reserveQuotaSlot } from '../lib/radar/quota.js';
import { decideRefresh } from '../lib/radar/refresh.js';
import {
  axesFromScores,
  summarizeFindings,
  toGlobalScore100,
  toRadarStatus,
} from '../lib/radar/summary.js';
import { generateTrackingToken, trackingUrl, verifyBearer } from '../lib/radar/tokens.js';
import { isBlockedViewerUserAgent } from '../lib/radar/ua-filter.js';
import {
  RadarViewBodySchema,
  VIEW_DEDUPE_WINDOW_MS,
  hashIp,
  userAgentFamily,
  viewHashSecret,
} from '../lib/radar/views.js';
import { generateSlug } from '../lib/slug.js';
import { checkUrlSafe, extractDomain, normalizeUrl } from '../lib/url-guard.js';
import { logger } from '../logger.js';
import { enqueueFullAudit } from '../queue/full-audit-queue.js';
import { requestInterpretation } from '../queue/radar-interpret-trigger.js';
import { redis } from '../redis.js';

/**
 * Radar B2B integration (contract: Radar repo docs/MYNTO.md).
 *
 *   POST /api/radar/audits                     Bearer RADAR_API_KEY
 *   GET  /api/radar/audits/:audit_id           Bearer RADAR_API_KEY
 *   POST /api/radar/audits/:audit_id/interpret Bearer RADAR_API_KEY
 *   POST /api/radar/audits/:audit_id/refresh   Bearer RADAR_API_KEY
 *   POST /api/radar/views                      public, per-IP rate limit
 *
 * `audit_id` on this API is radar_audits.id: several Radar rows can share
 * one scan (30-day per-domain cache), each with its own tracking token and
 * its own views.
 *
 * Tracking tokens are bearer secrets for the /r/<token> report: they are
 * never logged.
 */

const RADAR_AUDIT_EXPIRY_DAYS = 180;
const DAY_MS = 24 * 3600 * 1000;

const CreateBodySchema = RadarCreateAuditRequestSchema;

const AuditIdParamsSchema = z.object({
  audit_id: z.string().uuid(),
});

/** The repo returns the joined audit as a nested object; accept a 1-item array too. */
function embedOne<T extends z.ZodTypeAny>(schema: T) {
  return z.union([
    schema,
    z
      .array(schema)
      .length(1)
      .transform((a) => a[0] as z.infer<T>),
  ]);
}

const AuditFullEmbedSchema = z.object({
  status: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
});

const RadarRowSchema = z.object({
  id: z.string(),
  audit_id: z.string(),
  tracking_token: z.string(),
  reused: z.boolean(),
  audits_full: embedOne(AuditFullEmbedSchema),
});
type RadarRow = z.infer<typeof RadarRowSchema>;

const DetailRowSchema = z.object({
  id: z.string(),
  audit_id: z.string(),
  tracking_token: z.string(),
  reused: z.boolean(),
  audits_full: embedOne(
    z.object({
      status: z.string(),
      global_score: z.union([z.number(), z.string()]).nullable(),
      axis_scores: z.unknown(),
      llm_status: z.string().nullable(),
    }),
  ),
});

function createResponse(row: RadarRow): Record<string, unknown> {
  return {
    audit_id: row.id,
    tracking_token: row.tracking_token,
    tracking_url: trackingUrl(publicBaseUrl(), row.tracking_token),
    status: toRadarStatus(row.audits_full.status),
    reused: row.reused,
  };
}

async function findByExternalRef(externalRef: string): Promise<RadarRow | null | 'error'> {
  let data: unknown;
  try {
    data = await db().radar.findByExternalRef(externalRef);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'radar_lookup_external_ref_failed');
    return 'error';
  }
  if (data === null) return null;
  const parsed = RadarRowSchema.safeParse(data);
  return parsed.success ? parsed.data : 'error';
}

async function insertRadarRow(input: {
  auditId: string;
  externalRef: string;
  domain: string;
  reused: boolean;
}): Promise<RadarRow | 'conflict' | 'error'> {
  let data: unknown;
  try {
    data = await db().radar.insertLink({ ...input, trackingToken: generateTrackingToken() });
  } catch (err) {
    // 23505 unique_violation: a concurrent call with the same external_ref won.
    if (isUniqueViolation(err)) return 'conflict';
    logger.error({ code: pgErrorCode(err) }, 'radar_insert_failed');
    return 'error';
  }
  const parsed = RadarRowSchema.safeParse(data);
  return parsed.success ? parsed.data : 'error';
}

function requireRadarKey(req: FastifyRequest, reply: FastifyReply): boolean {
  const key = config.RADAR_API_KEY;
  if (!key) {
    void reply.code(503).send({ error: 'radar_disabled' });
    return false;
  }
  if (!verifyBearer(req.headers.authorization, key)) {
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

export function registerRadarRoutes(app: FastifyInstance): void {
  const authedRateLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } };

  app.post('/api/radar/audits', { config: authedRateLimit }, async (req, reply) => {
    if (!requireRadarKey(req, reply)) return reply;

    const parsed = CreateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.issues });
    }
    const { url, external_ref: externalRef } = parsed.data;

    // 1. Idempotency per external_ref.
    const existing = await findByExternalRef(externalRef);
    if (existing === 'error') return reply.code(500).send({ error: 'lookup_failed' });
    if (existing !== null) return reply.code(200).send(createResponse(existing));

    // 2. Same URL guard as the anonymous route.
    const normalized = normalizeUrl(url);
    if (normalized === null) return reply.code(400).send({ error: 'invalid_url' });
    const domain = extractDomain(normalized);
    if (!domain) return reply.code(400).send({ error: 'invalid_url' });
    const safety = await checkUrlSafe(normalized);
    if (!safety.ok) {
      logger.warn({ reason: safety.reason, domain }, 'radar_audit_rejected_unsafe_url');
      return reply.code(400).send({ error: 'unsafe_url', reason: safety.reason });
    }

    // 3. 30-day per-domain cache: reuse a recent scan, new tracking token.
    let cached: unknown[];
    try {
      cached = await db().radar.listDomainCandidates(domain);
    } catch (err) {
      logger.error({ code: pgErrorCode(err) }, 'radar_cache_lookup_failed');
      return reply.code(500).send({ error: 'lookup_failed' });
    }
    const candidates: CacheCandidate[] = [];
    for (const raw of cached) {
      const row = z
        .object({ audit_id: z.string(), audits_full: embedOne(AuditFullEmbedSchema) })
        .safeParse(raw);
      if (row.success) {
        candidates.push({
          auditId: row.data.audit_id,
          auditStatus: row.data.audits_full.status,
          auditCreatedAt: row.data.audits_full.created_at,
          auditExpiresAt: row.data.audits_full.expires_at,
        });
      }
    }
    const reusable = pickReusableAudit(candidates);
    if (reusable !== null) {
      const inserted = await insertRadarRow({
        auditId: reusable.auditId,
        externalRef,
        domain,
        reused: true,
      });
      if (inserted === 'conflict') {
        const winner = await findByExternalRef(externalRef);
        if (winner === null || winner === 'error')
          return reply.code(500).send({ error: 'insert_failed' });
        return reply.code(200).send(createResponse(winner));
      }
      if (inserted === 'error') return reply.code(500).send({ error: 'insert_failed' });
      logger.info({ externalRef, domain }, 'radar_audit_reused');
      return reply.code(201).send(createResponse(inserted));
    }

    // 4. Daily quota on NEW scans only.
    const quota = await reserveQuotaSlot(redis, config.RADAR_DAILY_AUDIT_QUOTA);
    if (!quota.ok) {
      if (quota.reason === 'quota_exceeded') {
        logger.warn({ limit: quota.limit }, 'radar_quota_exceeded');
        return reply
          .code(429)
          .send({ error: 'quota_exceeded', limit: quota.limit, resets_at: quota.resetsAt });
      }
      logger.error('radar_quota_backend_unavailable');
      return reply.code(503).send({ error: 'quota_unavailable' });
    }

    // 5. New scan + its radar row, in one transaction. No email: the report
    // is never sent, only linked.
    const slug = generateSlug();
    let created: unknown;
    try {
      created = await db().radar.createScanWithLink(
        {
          slug,
          url: normalized,
          email: null,
          status: 'queued',
          source: 'radar',
          llmStatus: 'deferred',
          expiresAt: new Date(Date.now() + RADAR_AUDIT_EXPIRY_DAYS * DAY_MS).toISOString(),
          modules: await modulesForNewAudit(),
        },
        { externalRef, domain, trackingToken: generateTrackingToken(), reused: false },
      );
    } catch (err) {
      // Nothing was written (rolled back): give the slot back.
      await releaseQuotaSlot(redis, quota.key);
      if (isUniqueViolation(err)) {
        // A concurrent call with the same external_ref won.
        const winner = await findByExternalRef(externalRef);
        if (winner !== null && winner !== 'error') {
          return reply.code(200).send(createResponse(winner));
        }
      } else {
        logger.error({ code: pgErrorCode(err) }, 'radar_audit_insert_failed');
      }
      return reply.code(500).send({ error: 'insert_failed' });
    }
    const createdRow = RadarRowSchema.safeParse(created);
    if (!createdRow.success) return reply.code(500).send({ error: 'insert_failed' });
    const inserted = createdRow.data;
    const auditId = inserted.audit_id;

    try {
      await enqueueFullAudit({ auditId, slug, url: normalized, radar: true });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : 'unknown' },
        'radar_audit_enqueue_failed',
      );
      await db()
        .audits.finish(auditId, { status: 'failed', llm_error: 'enqueue_failed' })
        .catch((e: unknown) => {
          logger.error({ code: pgErrorCode(e) }, 'radar_audit_mark_failed_failed');
        });
      return reply.code(503).send({ error: 'queue_unavailable' });
    }

    logger.info({ externalRef, domain, quotaCount: quota.count }, 'radar_audit_queued');
    return reply.code(201).send(createResponse(inserted));
  });

  app.get('/api/radar/audits/:audit_id', { config: authedRateLimit }, async (req, reply) => {
    if (!requireRadarKey(req, reply)) return reply;
    const params = AuditIdParamsSchema.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });

    let data: unknown;
    try {
      data = await db().radar.getDetail(params.data.audit_id);
    } catch (err) {
      logger.error({ code: pgErrorCode(err) }, 'radar_get_failed');
      return reply.code(500).send({ error: 'fetch_failed' });
    }
    if (data === null) return reply.code(404).send({ error: 'not_found' });
    const row = DetailRowSchema.safeParse(data);
    if (!row.success) return reply.code(500).send({ error: 'fetch_failed' });
    const audit = row.data.audits_full;
    const completed = audit.status === 'completed';

    let findings: ReturnType<typeof summarizeFindings> = [];
    if (completed) {
      try {
        findings = summarizeFindings(await db().radar.listFindingSummaries(row.data.audit_id));
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'radar_get_findings_failed');
        return reply.code(500).send({ error: 'fetch_failed' });
      }
    }

    return reply.send({
      audit_id: row.data.id,
      status: toRadarStatus(audit.status),
      global_score: completed ? toGlobalScore100(audit.global_score) : null,
      axes: completed ? axesFromScores(audit.axis_scores) : {},
      findings,
      interpreted: audit.llm_status === 'done',
      tracking_url: trackingUrl(publicBaseUrl(), row.data.tracking_token),
      reused: row.data.reused,
    });
  });

  app.post(
    '/api/radar/audits/:audit_id/interpret',
    { config: authedRateLimit },
    async (req, reply) => {
      if (!requireRadarKey(req, reply)) return reply;
      const params = AuditIdParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(404).send({ error: 'not_found' });

      let ref: { id: string; audit_id: string } | null;
      try {
        ref = await db().radar.getAuditRef(params.data.audit_id);
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'radar_interpret_lookup_failed');
        return reply.code(500).send({ error: 'fetch_failed' });
      }
      if (ref === null) return reply.code(404).send({ error: 'not_found' });
      const auditId = ref.audit_id;

      const result = await requestInterpretation(auditId);
      switch (result) {
        case 'queued':
        case 'waiting_scan':
          return reply
            .code(202)
            .send({ audit_id: params.data.audit_id, interpretation: 'pending' });
        case 'already_done':
        case 'not_applicable':
          return reply.code(202).send({ audit_id: params.data.audit_id, interpretation: 'done' });
        case 'scan_failed':
          return reply.code(409).send({ error: 'audit_failed' });
        case 'not_found':
          return reply.code(404).send({ error: 'not_found' });
        case 'error':
          return reply.code(500).send({ error: 'interpret_failed' });
      }
    },
  );

  // Rescan the site behind an existing radar row. Same tracking token, same
  // /r/<token> link: every radar row on the old scan is repointed to the new
  // one. The narrative runs automatically once the scan completes
  // (llm_status 'pending'). Internal maintenance: not counted in the daily quota.
  app.post(
    '/api/radar/audits/:audit_id/refresh',
    { config: authedRateLimit },
    async (req, reply) => {
      if (!requireRadarKey(req, reply)) return reply;
      const params = AuditIdParamsSchema.safeParse(req.params);
      if (!params.success) return reply.code(404).send({ error: 'not_found' });

      let lookup: unknown;
      try {
        lookup = await db().radar.getForRefresh(params.data.audit_id);
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'radar_refresh_lookup_failed');
        return reply.code(500).send({ error: 'fetch_failed' });
      }
      if (lookup === null) return reply.code(404).send({ error: 'not_found' });
      const row = z
        .object({
          id: z.string(),
          audit_id: z.string(),
          audits_full: embedOne(
            z.object({ url: z.string(), status: z.string(), created_at: z.string() }),
          ),
        })
        .safeParse(lookup);
      if (!row.success) return reply.code(500).send({ error: 'fetch_failed' });
      const oldAuditId = row.data.audit_id;
      const scan = row.data.audits_full;

      const decision = decideRefresh({ status: scan.status, createdAt: scan.created_at });
      if (decision !== 'refresh') {
        return reply.code(200).send({
          audit_id: params.data.audit_id,
          refreshed: false,
          reason: decision,
          status: toRadarStatus(scan.status),
        });
      }

      // New scan + repoint of every radar row of the old scan, in one
      // transaction. Conditional on the old scan id: a concurrent refresh of
      // a sibling row that already repointed everything makes the repoint
      // match nothing, and the new scan is rolled back.
      const slug = generateSlug();
      let refreshed: RefreshResult;
      try {
        refreshed = await db().radar.refreshScan(oldAuditId, {
          slug,
          url: scan.url,
          email: null,
          status: 'queued',
          source: 'radar',
          llmStatus: 'pending',
          expiresAt: new Date(Date.now() + RADAR_AUDIT_EXPIRY_DAYS * DAY_MS).toISOString(),
          modules: await modulesOfAudit(oldAuditId),
        });
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'radar_refresh_failed');
        return reply.code(500).send({ error: 'repoint_failed' });
      }
      if (refreshed.kind === 'in_progress') {
        return reply
          .code(200)
          .send({ audit_id: params.data.audit_id, refreshed: false, reason: 'in_progress' });
      }
      const newAuditId = refreshed.newAuditId;

      try {
        await enqueueFullAudit({
          auditId: newAuditId,
          slug,
          url: scan.url,
          radar: true,
        });
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : 'unknown' },
          'radar_refresh_enqueue_failed',
        );
        // Put the links back on the previous, complete scan.
        await db()
          .radar.undoRefresh(oldAuditId, newAuditId)
          .catch((e: unknown) => {
            logger.error({ code: pgErrorCode(e) }, 'radar_refresh_undo_failed');
          });
        return reply.code(503).send({ error: 'queue_unavailable' });
      }

      const rows = refreshed.rowsRepointed;
      logger.info({ rows }, 'radar_audit_refreshed');
      return reply.code(202).send({
        audit_id: params.data.audit_id,
        refreshed: true,
        rows_repointed: rows,
        status: 'pending',
      });
    },
  );

  // Public: called by the web proxy for the /r/<token> beacon. No API key
  // (the browser cannot hold one); the unguessable token is the gate.
  // The beacon only says "opened": one view per (link, hashed IP) per 30 min.
  const ipHashSecret = viewHashSecret(config.AUDIT_VIEWS_IP_HASH_SECRET);
  app.post(
    '/api/radar/views',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = RadarViewBodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      const body = parsed.data;

      const userAgent = req.headers['user-agent'];
      if (isBlockedViewerUserAgent(userAgent)) {
        return reply.code(202).send({ counted: false });
      }

      let lookup: unknown;
      try {
        lookup = await db().radar.findByToken(body.token);
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'radar_view_lookup_failed');
        return reply.code(500).send({ error: 'lookup_failed' });
      }
      const link = z
        .object({
          id: z.string(),
          audit_id: z.string(),
          tracking_token: z.string(),
          audits_full: embedOne(z.object({ expires_at: z.string() })),
        })
        .safeParse(lookup);
      if (!link.success || Date.parse(link.data.audits_full.expires_at) <= Date.now()) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const radarAuditId = link.data.id;

      const viewedAt = new Date().toISOString();
      let result: 'recorded' | 'deduped';
      try {
        result = await db().radar.recordView({
          radarAuditId,
          ipHash: hashIp(rateLimitKey(req), ipHashSecret),
          userAgent: userAgentFamily(userAgent),
          viewedAt,
          dedupeWindowMs: VIEW_DEDUPE_WINDOW_MS,
        });
      } catch (err) {
        logger.error({ code: pgErrorCode(err) }, 'radar_view_insert_failed');
        return reply.code(500).send({ error: 'insert_failed' });
      }
      if (result === 'deduped') return reply.code(202).send({ counted: false });

      // Side effects never block the beacon answer.
      void requestInterpretation(link.data.audit_id).catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : 'unknown' },
          'radar_view_interpret_trigger_failed',
        );
      });
      // link.opened / link.first_opened (and the Radar "audit_viewed" body)
      // were written to the webhook outbox by recordView, in its transaction.

      logger.info({ radarAuditId }, 'radar_view_counted');
      return reply.code(202).send({ counted: true });
    },
  );
}
