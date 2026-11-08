import { type Queryable, type Sql } from '../client.js';

import { createAuditsRepo, type CreateAuditInput } from './audits.js';
import { emitWebhookEvent } from './webhooks.js';

/**
 * radar_audits / radar_audit_views. Join results keep the nested
 * `audits_full: {...}` shape the callers used with PostgREST embeds
 * (`audits_full!inner(...)`): an inner join, so a radar row without its
 * audit is simply not returned.
 */

export interface RadarLinkRow {
  id: string;
  audit_id: string;
  tracking_token: string;
  reused: boolean;
  audits_full: { status: string; created_at: string; expires_at: string };
}

export interface RadarDetailRow {
  id: string;
  audit_id: string;
  tracking_token: string;
  reused: boolean;
  audits_full: {
    status: string;
    global_score: number | null;
    axis_scores: unknown;
    llm_status: string | null;
  };
}

export interface RadarCacheCandidateRow {
  audit_id: string;
  audits_full: { status: string; created_at: string; expires_at: string };
}

export interface RadarRefreshRow {
  id: string;
  audit_id: string;
  audits_full: { url: string; status: string; created_at: string };
}

export interface RadarTokenRow {
  id: string;
  audit_id: string;
  tracking_token: string;
  audits_full: { slug: string; expires_at: string };
}

export interface InsertRadarAuditInput {
  auditId: string;
  /** Radar prospect id. NULL for links created from the dashboard. */
  externalRef: string | null;
  domain: string;
  trackingToken: string;
  reused: boolean;
  /** 'radar' (default) or 'dashboard'. */
  origin?: 'radar' | 'dashboard';
}

export interface InsertRadarViewInput {
  radarAuditId: string;
  /** HMAC of the client IP. NULL disables the dedupe for this view. */
  ipHash: string | null;
  /** Coarse browser family (no raw User-Agent), at most 200 chars. */
  userAgent: string | null;
  /** ISO timestamp, also used for last_viewed_at. */
  viewedAt: string;
  /** Same (link, ip_hash) within this window = same view. */
  dedupeWindowMs: number;
}

export type RecordViewResult = 'recorded' | 'deduped';

export type RefreshResult =
  | { kind: 'ok'; newAuditId: string; rowsRepointed: number }
  | { kind: 'in_progress' };

/** Internal marker to roll a transaction back without surfacing an error. */
class Rollback extends Error {}

async function selectLinkBy(
  db: Queryable,
  where: 'external_ref' | 'id',
  value: string,
): Promise<RadarLinkRow | null> {
  const rows = await db<
    {
      id: string;
      audit_id: string;
      tracking_token: string;
      reused: boolean;
      status: string;
      created_at: string;
      expires_at: string;
    }[]
  >`
    select r.id, r.audit_id, r.tracking_token, r.reused,
           a.status, a.created_at, a.expires_at
      from radar_audits r
      join audits_full a on a.id = r.audit_id
     where ${db('r.' + where)} = ${value}
  `;
  const r = rows[0];
  if (r === undefined) return null;
  return {
    id: r.id,
    audit_id: r.audit_id,
    tracking_token: r.tracking_token,
    reused: r.reused,
    audits_full: { status: r.status, created_at: r.created_at, expires_at: r.expires_at },
  };
}

export function createRadarRepo(sql: Sql) {
  const audits = createAuditsRepo(sql);

  async function insertLink(db: Queryable, input: InsertRadarAuditInput): Promise<RadarLinkRow> {
    const [row] = await db<{ id: string }[]>`
      insert into radar_audits (audit_id, external_ref, domain, tracking_token, reused, origin)
      values (${input.auditId}, ${input.externalRef}, ${input.domain}, ${input.trackingToken},
              ${input.reused}, ${input.origin ?? 'radar'})
      returning id
    `;
    if (row === undefined) throw new Error('radar_audits insert returned no row');
    const link = await selectLinkBy(db, 'id', row.id);
    if (link === null) throw new Error('radar_audits row vanished after insert');
    return link;
  }

  return {
    findByExternalRef(externalRef: string): Promise<RadarLinkRow | null> {
      return selectLinkBy(sql, 'external_ref', externalRef);
    },

    /**
     * Inserts a radar row on an existing audit (cache hit). A duplicate
     * external_ref throws a Postgres error with code '23505'.
     */
    insertLink(input: InsertRadarAuditInput): Promise<RadarLinkRow> {
      return insertLink(sql, input);
    },

    /**
     * New scan + its radar row, atomically. A duplicate external_ref
     * (concurrent request) rolls both back and throws code '23505'.
     */
    async createScanWithLink(
      audit: CreateAuditInput,
      link: Omit<InsertRadarAuditInput, 'auditId'>,
    ): Promise<RadarLinkRow> {
      return sql.begin(async (tx) => {
        const auditId = await audits.create(audit, tx);
        const row = await insertLink(tx, { ...link, auditId });
        await emitWebhookEvent(tx, { type: 'audit.created', auditId });
        return row;
      });
    },

    /** Last 20 radar rows of a domain with their scan, newest first. */
    async listDomainCandidates(domain: string): Promise<RadarCacheCandidateRow[]> {
      const rows = await sql<
        { audit_id: string; status: string; created_at: string; expires_at: string }[]
      >`
        select r.audit_id, a.status, a.created_at, a.expires_at
          from radar_audits r
          join audits_full a on a.id = r.audit_id
         where r.domain = ${domain}
         order by r.created_at desc
         limit 20
      `;
      return rows.map((r) => ({
        audit_id: r.audit_id,
        audits_full: { status: r.status, created_at: r.created_at, expires_at: r.expires_at },
      }));
    },

    async getDetail(id: string): Promise<RadarDetailRow | null> {
      const [r] = await sql<
        {
          id: string;
          audit_id: string;
          tracking_token: string;
          reused: boolean;
          status: string;
          global_score: number | null;
          axis_scores: unknown;
          llm_status: string | null;
        }[]
      >`
        select r.id, r.audit_id, r.tracking_token, r.reused,
               a.status, a.global_score, a.axis_scores, a.llm_status
          from radar_audits r
          join audits_full a on a.id = r.audit_id
         where r.id = ${id}
      `;
      if (r === undefined) return null;
      return {
        id: r.id,
        audit_id: r.audit_id,
        tracking_token: r.tracking_token,
        reused: r.reused,
        audits_full: {
          status: r.status,
          global_score: r.global_score,
          axis_scores: r.axis_scores,
          llm_status: r.llm_status,
        },
      };
    },

    async getAuditRef(id: string): Promise<{ id: string; audit_id: string } | null> {
      const [r] = await sql<{ id: string; audit_id: string }[]>`
        select id, audit_id from radar_audits where id = ${id}
      `;
      return r ?? null;
    },

    async getForRefresh(id: string): Promise<RadarRefreshRow | null> {
      const [r] = await sql<
        { id: string; audit_id: string; url: string; status: string; created_at: string }[]
      >`
        select r.id, r.audit_id, a.url, a.status, a.created_at
          from radar_audits r
          join audits_full a on a.id = r.audit_id
         where r.id = ${id}
      `;
      if (r === undefined) return null;
      return {
        id: r.id,
        audit_id: r.audit_id,
        audits_full: { url: r.url, status: r.status, created_at: r.created_at },
      };
    },

    /**
     * Rescan: inserts the new audit and repoints every radar row of the old
     * scan to it, in one transaction. When nothing was repointed (a
     * concurrent refresh already moved the rows) the insert is rolled back.
     */
    async refreshScan(oldAuditId: string, audit: CreateAuditInput): Promise<RefreshResult> {
      try {
        return await sql.begin(async (tx) => {
          const newAuditId = await audits.create(audit, tx);
          const res = await tx`
            update radar_audits set audit_id = ${newAuditId} where audit_id = ${oldAuditId}
          `;
          if (res.count === 0) throw new Rollback();
          await tx`update audits_full set replaced_by = ${newAuditId} where id = ${oldAuditId}`;
          return { kind: 'ok' as const, newAuditId, rowsRepointed: res.count };
        });
      } catch (err) {
        if (err instanceof Rollback) return { kind: 'in_progress' };
        throw err;
      }
    },

    /** Undo of refreshScan when the job could not be enqueued. */
    async undoRefresh(oldAuditId: string, newAuditId: string): Promise<void> {
      await sql.begin(async (tx) => {
        await tx`update radar_audits set audit_id = ${oldAuditId} where audit_id = ${newAuditId}`;
        // Deleting the new scan sets the old one's replaced_by back to NULL.
        await tx`delete from audits_full where id = ${newAuditId}`;
      });
    },

    /** Token lookup with the audit's slug and expiry (inner join). */
    async findByToken(token: string): Promise<RadarTokenRow | null> {
      const [r] = await sql<
        { id: string; audit_id: string; tracking_token: string; slug: string; expires_at: string }[]
      >`
        select r.id, r.audit_id, r.tracking_token, a.slug, a.expires_at
          from radar_audits r
          join audits_full a on a.id = r.audit_id
         where r.tracking_token = ${token}
      `;
      if (r === undefined) return null;
      return {
        id: r.id,
        audit_id: r.audit_id,
        tracking_token: r.tracking_token,
        audits_full: { slug: r.slug, expires_at: r.expires_at },
      };
    },

    /** Findings summary (axis, severity, title) for the Radar API. */
    async listFindingSummaries(
      auditId: string,
    ): Promise<{ axis: string; severity: string; title: string }[]> {
      return sql<{ axis: string; severity: string; title: string }[]>`
        select axis, severity, title from audit_findings_full where audit_id = ${auditId}
      `;
    },

    /**
     * Records one opening of a tracking link. Deduped on (link, ip_hash)
     * over `dedupeWindowMs`: a second beacon from the same visitor in the
     * window is ignored. The check and the insert share one transaction and
     * an advisory lock on (link, ip_hash), so two concurrent beacons cannot
     * both count. A new view bumps views_count and last_viewed_at.
     */
    async recordView(input: InsertRadarViewInput): Promise<RecordViewResult> {
      return sql.begin(async (tx) => {
        if (input.ipHash !== null) {
          const lockKey = `${input.radarAuditId}:${input.ipHash}`;
          await tx`select pg_advisory_xact_lock(hashtext(${lockKey}))`;
          const since = new Date(Date.parse(input.viewedAt) - input.dedupeWindowMs).toISOString();
          const dup = await tx`
            select 1 from radar_audit_views
             where radar_audit_id = ${input.radarAuditId}
               and ip_hash = ${input.ipHash}
               and viewed_at >= ${since}
             limit 1
          `;
          if (dup.length > 0) return 'deduped' as const;
        }
        await tx`
          insert into radar_audit_views (radar_audit_id, ip_hash, user_agent, viewed_at)
          values (${input.radarAuditId}, ${input.ipHash}, ${input.userAgent}, ${input.viewedAt})
        `;
        const [link] = await tx<{ views_count: number }[]>`
          update radar_audits
             set views_count = views_count + 1,
                 last_viewed_at = greatest(coalesce(last_viewed_at, ${input.viewedAt}::timestamptz), ${input.viewedAt}::timestamptz)
           where id = ${input.radarAuditId}
          returning views_count
        `;
        // Outbox, same transaction as the view (the former dedicated Radar
        // queue is replaced by the endpoint flagged legacy_radar_format).
        const opened = { linkId: input.radarAuditId, occurredAt: input.viewedAt };
        if (link?.views_count === 1) {
          await emitWebhookEvent(tx, { type: 'link.first_opened', ...opened });
        }
        await emitWebhookEvent(tx, { type: 'link.opened', ...opened });
        return 'recorded' as const;
      });
    },
  };
}

export type RadarRepo = ReturnType<typeof createRadarRepo>;
