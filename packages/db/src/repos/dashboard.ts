import { AI_READINESS_LOW_THRESHOLD } from '@mynto/shared';
import type postgres from 'postgres';

import type { Queryable, Sql } from '../client.js';

import { createAuditsRepo, type AuditSource, type CreateAuditInput } from './audits.js';
import { emitWebhookEvent } from './webhooks.js';

/**
 * Admin dashboard reads and writes. Never used by public routes: rows here
 * include internal columns (source, label) that public reads never select.
 *
 * "Current" audits are the ones not replaced by a refresh
 * (replaced_by IS NULL). Radar scans that lost every tracking link (refreshed
 * before migration 0002 introduced replaced_by) are hidden too.
 */

export type DashboardStatusFilter = 'in_progress' | 'completed' | 'failed' | 'expired';
export type DashboardSort = 'created_desc' | 'created_asc' | 'score_desc' | 'score_asc';

export interface ListAuditsFilter {
  /** Case-insensitive match on URL or label. */
  q?: string | null;
  status?: DashboardStatusFilter | null;
  source?: AuditSource | null;
  /** Inclusive lower bound on created_at (ISO). */
  createdFrom?: string | null;
  /** Exclusive upper bound on created_at (ISO). */
  createdTo?: string | null;
  /** Restrict to these audit ids. */
  ids?: readonly string[] | null;
  /** Only audits whose Préparation IA score is under AI_READINESS_LOW_THRESHOLD. */
  aiLow?: boolean | null;
  sort?: DashboardSort;
  limit?: number;
  offset?: number;
}

export interface DashboardAuditRow {
  id: string;
  slug: string;
  url: string;
  label: string | null;
  source: string;
  status: string;
  created_at: string;
  expires_at: string;
  global_score: number | null;
  global_band: string | null;
  axis_scores: unknown;
  /** Stored modules (null = all enabled, pre-0003). */
  modules: unknown;
  /** Préparation IA score 0-100 (null = not evaluated or failed). */
  ai_score: number | null;
  /** Préparation IA level, site type and run status, read out of ai_readiness. */
  ai_level: number | null;
  ai_site_type: string | null;
  ai_site_type_auto: boolean | null;
  ai_status: string | null;
  ai_included_in_global_score: boolean | null;
  scanned_at: string | null;
  /** Pages analysed (home + crawled internal pages), completed audits only. */
  pages: number | null;
  /** Preferred tracking token (dashboard link first), null when none. */
  tracking_token: string | null;
  /** Sum of views over every tracking link of the audit. */
  views_count: number;
  last_viewed_at: string | null;
  /** Media key of the site favicon (null = not fetched). */
  favicon_key: string | null;
  /** Media key of the hero screenshot (thumbnail on hover). */
  hero_screenshot_key: string | null;
  /** Report template of the audit (null = install default). */
  template_id: string | null;
  /** Step of a running audit (loading, analysis, writing). */
  progress_step: string | null;
  /** Global score (0-10) of the scan this one replaced, null when first scan. */
  prev_score: number | null;
}

export interface AuditHistoryPoint {
  id: string;
  created_at: string;
  status: string;
  global_score: number | null;
  ai_score: number | null;
}

export interface AuditOpenRow {
  viewed_at: string;
  user_agent: string | null;
  origin: string;
}

export interface AuditTopFinding {
  id: string;
  axis: string;
  severity: string;
  title: string;
}

export interface AuditDetailExtra {
  modules: unknown;
  external_refs: string[];
  llm_model: string | null;
  severity_counts: { P0: number; P1: number; P2: number; P3: number };
}

export interface HomeItem {
  id: string;
  url: string;
  label: string | null;
  status: string;
  global_score: number | null;
  favicon_key: string | null;
  created_at: string;
  expires_at: string;
  last_viewed_at: string | null;
  views_count: number;
  llm_error: string | null;
}

export interface WeekStats {
  audits: number;
  audits_prev: number;
  opens: number;
  opens_prev: number;
  avg_score: number | null;
  avg_score_prev: number | null;
  emails: number;
  emails_prev: number;
}

export interface DashboardCounts {
  all: number;
  in_progress: number;
  failed: number;
  radar: number;
  this_month: number;
  links: number;
}

export interface DashboardAuditRef {
  id: string;
  slug: string;
  url: string;
  label: string | null;
  source: string;
  status: string;
  created_at: string;
  expires_at: string;
  replaced_by: string | null;
}

export interface TrackingLinkRow {
  id: string;
  origin: string;
  external_ref: string | null;
  domain: string;
  tracking_token: string;
  views_count: number;
  last_viewed_at: string | null;
  created_at: string;
  audit_id: string;
  slug: string;
  status: string;
  label: string | null;
  expires_at: string;
}

export interface DeletedAudit {
  id: string;
  hero_screenshot_key: string | null;
  favicon_key: string | null;
}

export type DashboardRefreshResult = { kind: 'ok'; newAuditId: string } | { kind: 'in_progress' };

class Rollback extends Error {}

const MAX_LIMIT = 5000;

const ESCAPE_LIKE = /[\\%_]/g;

function likePattern(q: string): string {
  return `%${q.replace(ESCAPE_LIKE, (c) => `\\${c}`)}%`;
}

type Fragment = postgres.PendingQuery<postgres.Row[]>;

function whereClause(db: Queryable, f: ListAuditsFilter): Fragment {
  const parts: Fragment[] = [
    db`a.replaced_by is null`,
    db`(a.source <> 'radar' or exists (select 1 from radar_audits r0 where r0.audit_id = a.id))`,
  ];
  const q = f.q?.trim();
  if (q) {
    const p = likePattern(q.slice(0, 200));
    parts.push(db`(a.url ilike ${p} or a.label ilike ${p})`);
  }
  switch (f.status) {
    case 'in_progress':
      parts.push(db`a.status in ('queued', 'running') and a.expires_at > now()`);
      break;
    case 'completed':
      parts.push(db`a.status = 'completed' and a.expires_at > now()`);
      break;
    case 'failed':
      parts.push(db`a.status = 'failed' and a.expires_at > now()`);
      break;
    case 'expired':
      parts.push(db`a.expires_at <= now()`);
      break;
    default:
      break;
  }
  if (f.source) parts.push(db`a.source = ${f.source}`);
  if (f.aiLow)
    parts.push(db`a.ai_score is not null and a.ai_score < ${AI_READINESS_LOW_THRESHOLD}`);
  if (f.ids) parts.push(f.ids.length === 0 ? db`false` : db`a.id in ${db(f.ids as string[])}`);
  if (f.createdFrom) parts.push(db`a.created_at >= ${f.createdFrom}`);
  if (f.createdTo) parts.push(db`a.created_at < ${f.createdTo}`);

  const [first, ...rest] = parts;
  let out = first === undefined ? db`` : db`where ${first}`;
  for (const p of rest) out = db`${out} and ${p}`;
  return out;
}

function orderClause(db: Queryable, sort: DashboardSort | undefined): Fragment {
  switch (sort) {
    case 'created_asc':
      return db`order by a.created_at asc, a.id asc`;
    case 'score_desc':
      return db`order by a.global_score desc nulls last, a.created_at desc`;
    case 'score_asc':
      return db`order by a.global_score asc nulls last, a.created_at desc`;
    default:
      return db`order by a.created_at desc, a.id desc`;
  }
}

export function createDashboardRepo(sql: Sql) {
  const audits = createAuditsRepo(sql);

  return {
    /** Current audits matching the filter, with tracking info, plus the total. */
    async listAudits(
      filter: ListAuditsFilter = {},
    ): Promise<{ rows: DashboardAuditRow[]; total: number }> {
      const limit = Math.min(Math.max(filter.limit ?? 25, 1), MAX_LIMIT);
      const offset = Math.max(filter.offset ?? 0, 0);
      const where = whereClause(sql, filter);
      const rows = await sql<DashboardAuditRow[]>`
        select a.id, a.slug, a.url, a.label, a.source, a.status, a.created_at, a.expires_at,
               a.global_score, a.global_band, a.axis_scores, a.modules, a.scanned_at,
               a.ai_score::int as ai_score,
               (a.ai_readiness ->> 'level')::int as ai_level,
               a.ai_readiness ->> 'site_type' as ai_site_type,
               (a.ai_readiness ->> 'site_type_auto')::boolean as ai_site_type_auto,
               a.ai_readiness ->> 'status' as ai_status,
               (a.ai_readiness ->> 'included_in_global_score')::boolean as ai_included_in_global_score,
               case when a.status = 'completed' then
                 1 + case when jsonb_typeof(a.facts -> 'internalPagesCrawled') = 'array'
                          then jsonb_array_length(a.facts -> 'internalPagesCrawled') else 0 end
               end as pages,
               l.tracking_token,
               coalesce(v.views, 0)::int as views_count,
               v.last_viewed_at,
               a.favicon_key, a.hero_screenshot_key, a.template_id, a.progress_step,
               (select p.global_score::float8 from audits_full p
                 where p.replaced_by = a.id order by p.created_at desc limit 1) as prev_score
          from audits_full a
          left join lateral (
            select r.tracking_token from radar_audits r
             where r.audit_id = a.id
             order by (r.origin = 'dashboard') desc, r.created_at asc
             limit 1
          ) l on true
          left join lateral (
            select sum(r.views_count) as views, max(r.last_viewed_at) as last_viewed_at
              from radar_audits r where r.audit_id = a.id
          ) v on true
          ${where}
          ${orderClause(sql, filter.sort)}
         limit ${limit} offset ${offset}
      `;
      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from audits_full a ${whereClause(sql, filter)}
      `;
      return { rows: [...rows], total: count?.n ?? 0 };
    },

    /** Sidebar and tab counters. `monthStart` = ISO start of the current month. */
    async counts(monthStart: string): Promise<DashboardCounts> {
      const [row] = await sql<Omit<DashboardCounts, 'links'>[]>`
        select count(*)::int as "all",
               (count(*) filter (where a.status in ('queued', 'running') and a.expires_at > now()))::int as in_progress,
               (count(*) filter (where a.status = 'failed' and a.expires_at > now()))::int as failed,
               (count(*) filter (where a.source = 'radar'))::int as radar,
               (count(*) filter (where a.created_at >= ${monthStart}))::int as this_month
          from audits_full a
          ${whereClause(sql, {})}
      `;
      const [links] = await sql<{ n: number }[]>`
        select count(*)::int as n
          from radar_audits r join audits_full a on a.id = r.audit_id
         where a.expires_at > now()
      `;
      return {
        all: row?.all ?? 0,
        in_progress: row?.in_progress ?? 0,
        failed: row?.failed ?? 0,
        radar: row?.radar ?? 0,
        this_month: row?.this_month ?? 0,
        links: links?.n ?? 0,
      };
    },

    /** Status of a set of audits (dashboard poller). Unknown ids are absent. */
    async statuses(ids: readonly string[]): Promise<{ id: string; status: string }[]> {
      if (ids.length === 0) return [];
      return sql<{ id: string; status: string }[]>`
        select id, status from audits_full where id in ${sql(ids as string[])}
      `;
    },

    /** Current audit id at the end of the refresh chain (id itself when never refreshed). */
    async currentId(id: string): Promise<string | null> {
      const [row] = await sql<{ id: string }[]>`
        with recursive chain as (
          select id, replaced_by, 0 as depth from audits_full where id = ${id}
          union all
          select a.id, a.replaced_by, c.depth + 1
            from audits_full a join chain c on a.id = c.replaced_by
           where c.depth < 100
        )
        select id from chain where replaced_by is null limit 1
      `;
      return row?.id ?? null;
    },

    async getAudit(id: string): Promise<DashboardAuditRef | null> {
      const [row] = await sql<DashboardAuditRef[]>`
        select id, slug, url, label, source, status, created_at, expires_at, replaced_by
          from audits_full where id = ${id}
      `;
      return row ?? null;
    },

    /**
     * New dashboard audit + its tracking link, in one transaction.
     * Returns the audit id and the link token.
     */
    async createAuditWithLink(
      audit: CreateAuditInput,
      link: { domain: string; trackingToken: string },
    ): Promise<{ auditId: string; linkId: string; trackingToken: string }> {
      return sql.begin(async (tx) => {
        const auditId = await audits.create({ ...audit, source: audit.source ?? 'dashboard' }, tx);
        const [row] = await tx<{ id: string; tracking_token: string }[]>`
          insert into radar_audits (audit_id, external_ref, domain, tracking_token, reused, origin)
          values (${auditId}, null, ${link.domain}, ${link.trackingToken}, false, 'dashboard')
          returning id, tracking_token
        `;
        if (row === undefined) throw new Error('tracking link insert returned no row');
        await emitWebhookEvent(tx, { type: 'audit.created', auditId });
        return { auditId, linkId: row.id, trackingToken: row.tracking_token };
      });
    },

    /**
     * Rescan keeping the public links: inserts the new scan, marks the old
     * one as replaced and repoints its tracking links, atomically. A
     * concurrent refresh that already replaced the old scan rolls this one
     * back ('in_progress'). Undo with radar.undoRefresh(old, new).
     */
    async refreshAudit(oldId: string, audit: CreateAuditInput): Promise<DashboardRefreshResult> {
      try {
        return await sql.begin(async (tx) => {
          const newAuditId = await audits.create(audit, tx);
          const res = await tx`
            update audits_full set replaced_by = ${newAuditId}
             where id = ${oldId} and replaced_by is null
          `;
          if (res.count === 0) throw new Rollback();
          await tx`update radar_audits set audit_id = ${newAuditId} where audit_id = ${oldId}`;
          // The new scan keeps the report template; the send log stays reachable
          // through the refresh chain (email.listSends).
          await tx`
            update audits_full set template_id = (select template_id from audits_full where id = ${oldId})
             where id = ${newAuditId}
          `;
          return { kind: 'ok' as const, newAuditId };
        });
      } catch (err) {
        if (err instanceof Rollback) return { kind: 'in_progress' };
        throw err;
      }
    },

    /**
     * Deletes an audit and every older scan it replaced (findings, views and
     * tracking links cascade). Returns the deleted ids and hero keys so the
     * caller removes the media files.
     */
    async deleteAudit(id: string): Promise<DeletedAudit[]> {
      return sql
        .begin(async (tx) => {
          // Snapshot before the rows go: the event carries the audit as it was.
          await emitWebhookEvent(tx, { type: 'audit.deleted', auditId: id });
          const rows = await tx<DeletedAudit[]>`
          with recursive chain as (
            select id from audits_full where id = ${id}
            union all
            select a.id from audits_full a join chain c on a.replaced_by = c.id
          )
          delete from audits_full where id in (select id from chain)
          returning id, hero_screenshot_key, favicon_key
        `;
          if (rows.length === 0) throw new Rollback();
          return [...rows];
        })
        .catch((err: unknown) => {
          if (err instanceof Rollback) return [];
          throw err;
        });
    },

    /** Scans of an audit's refresh chain, oldest first (current one last). */
    async history(id: string): Promise<AuditHistoryPoint[]> {
      return sql<AuditHistoryPoint[]>`
        with recursive back as (
          select id, 0 as depth from audits_full where id = ${id}
          union all
          select a.id, b.depth + 1 from audits_full a join back b on a.replaced_by = b.id
           where b.depth < 50
        )
        select a.id, a.created_at, a.status, a.global_score::float8 as global_score,
               a.ai_score::int as ai_score
          from audits_full a join back b on b.id = a.id
         order by a.created_at asc
      `;
    },

    /** Openings of the tracking links of an audit, newest first. */
    async opens(id: string, limit = 20): Promise<{ rows: AuditOpenRow[]; first: string | null }> {
      const rows = await sql<AuditOpenRow[]>`
        select v.viewed_at, v.user_agent, r.origin
          from radar_audit_views v join radar_audits r on r.id = v.radar_audit_id
         where r.audit_id = ${id}
         order by v.viewed_at desc
         limit ${Math.min(Math.max(limit, 1), 100)}
      `;
      const [first] = await sql<{ first: string | null }[]>`
        select min(v.viewed_at) as first
          from radar_audit_views v join radar_audits r on r.id = v.radar_audit_id
         where r.audit_id = ${id}
      `;
      return { rows: [...rows], first: first?.first ?? null };
    },

    /** P0 and P1 findings of an audit (side panel). */
    async topFindings(id: string, limit = 6): Promise<AuditTopFinding[]> {
      return sql<AuditTopFinding[]>`
        select id, axis, severity, title from audit_findings_full
         where audit_id = ${id} and severity in ('P0', 'P1')
         order by severity asc, created_at asc
         limit ${Math.min(Math.max(limit, 1), 50)}
      `;
    },

    /** Extra fields of the side panel. */
    async detailExtra(id: string): Promise<AuditDetailExtra | null> {
      const [row] = await sql<
        { modules: unknown; llm_model: string | null; external_refs: string[] | null }[]
      >`
        select a.modules, a.llm_model,
               (select array_agg(r.external_ref) from radar_audits r
                 where r.audit_id = a.id and r.external_ref is not null) as external_refs
          from audits_full a where a.id = ${id}
      `;
      if (row === undefined) return null;
      const counts = await sql<{ severity: string; n: number }[]>`
        select severity, count(*)::int as n from audit_findings_full
         where audit_id = ${id} group by severity
      `;
      const sc = { P0: 0, P1: 0, P2: 0, P3: 0 };
      for (const c of counts) {
        if (c.severity in sc) sc[c.severity as keyof typeof sc] = c.n;
      }
      return {
        modules: row.modules,
        llm_model: row.llm_model,
        external_refs: row.external_refs ?? [],
        severity_counts: sc,
      };
    },

    /**
     * Home "À faire": links opened in the last 14 days (follow up), failed
     * audits, completed audits expiring within 7 days.
     */
    async todo(
      limit = 6,
    ): Promise<{ opened: HomeItem[]; failed: HomeItem[]; expiring: HomeItem[] }> {
      const lim = Math.min(Math.max(limit, 1), 50);
      const base = sql`
        select a.id, a.url, a.label, a.status, a.global_score::float8 as global_score,
               a.favicon_key, a.created_at, a.expires_at, a.llm_error,
               v.last_viewed_at, coalesce(v.views, 0)::int as views_count
          from audits_full a
          left join lateral (
            select sum(r.views_count) as views, max(r.last_viewed_at) as last_viewed_at
              from radar_audits r where r.audit_id = a.id
          ) v on true
         where a.replaced_by is null and a.expires_at > now()
      `;
      const opened = await sql<HomeItem[]>`
        ${base} and a.status = 'completed' and v.last_viewed_at > now() - interval '14 days'
        order by v.last_viewed_at desc limit ${lim}
      `;
      const failed = await sql<HomeItem[]>`
        ${base} and a.status = 'failed' order by a.created_at desc limit ${lim}
      `;
      const expiring = await sql<HomeItem[]>`
        ${base} and a.status = 'completed' and a.expires_at < now() + interval '7 days'
        order by a.expires_at asc limit ${lim}
      `;
      return { opened: [...opened], failed: [...failed], expiring: [...expiring] };
    },

    /** This week vs the week before (rolling 7 days). */
    async weekStats(): Promise<WeekStats> {
      const [a] = await sql<
        {
          audits: number;
          audits_prev: number;
          avg_score: number | null;
          avg_score_prev: number | null;
        }[]
      >`
        select
          (count(*) filter (where created_at > now() - interval '7 days'))::int as audits,
          (count(*) filter (where created_at <= now() - interval '7 days'
                              and created_at > now() - interval '14 days'))::int as audits_prev,
          (avg(global_score) filter (where status = 'completed'
                                      and created_at > now() - interval '7 days'))::float8 as avg_score,
          (avg(global_score) filter (where status = 'completed'
                                      and created_at <= now() - interval '7 days'
                                      and created_at > now() - interval '14 days'))::float8 as avg_score_prev
          from audits_full
         where created_at > now() - interval '14 days'
      `;
      const [o] = await sql<{ opens: number; opens_prev: number }[]>`
        select (count(*) filter (where viewed_at > now() - interval '7 days'))::int as opens,
               (count(*) filter (where viewed_at <= now() - interval '7 days'))::int as opens_prev
          from radar_audit_views where viewed_at > now() - interval '14 days'
      `;
      const [e] = await sql<{ emails: number; emails_prev: number }[]>`
        select (count(*) filter (where created_at > now() - interval '7 days'))::int as emails,
               (count(*) filter (where created_at <= now() - interval '7 days'))::int as emails_prev
          from email_sends where status = 'sent' and created_at > now() - interval '14 days'
      `;
      return {
        audits: a?.audits ?? 0,
        audits_prev: a?.audits_prev ?? 0,
        avg_score: a?.avg_score ?? null,
        avg_score_prev: a?.avg_score_prev ?? null,
        opens: o?.opens ?? 0,
        opens_prev: o?.opens_prev ?? 0,
        emails: e?.emails ?? 0,
        emails_prev: e?.emails_prev ?? 0,
      };
    },

    /** Tracking links (dashboard and Radar), newest first, non-expired audits. */
    async listLinks(
      opts: { limit?: number; offset?: number } = {},
    ): Promise<{ rows: TrackingLinkRow[]; total: number }> {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), MAX_LIMIT);
      const offset = Math.max(opts.offset ?? 0, 0);
      const rows = await sql<TrackingLinkRow[]>`
        select r.id, r.origin, r.external_ref, r.domain, r.tracking_token, r.views_count,
               r.last_viewed_at, r.created_at, a.id as audit_id, a.slug, a.status, a.label,
               a.expires_at
          from radar_audits r
          join audits_full a on a.id = r.audit_id
         where a.expires_at > now()
         order by r.created_at desc, r.id desc
         limit ${limit} offset ${offset}
      `;
      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n
          from radar_audits r join audits_full a on a.id = r.audit_id
         where a.expires_at > now()
      `;
      return { rows: [...rows], total: count?.n ?? 0 };
    },
  };
}

export type DashboardRepo = ReturnType<typeof createDashboardRepo>;
