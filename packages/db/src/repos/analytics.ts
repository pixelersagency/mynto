import {
  AI_CHECK_LABEL,
  AI_READINESS_LOW_THRESHOLD,
  ALL_AXES,
  AUDIT_RULES_META,
  AiCheckIdSchema,
  aiRuleCode,
  type ApiAnalyticsSummary,
  type AuditAxis,
} from '@mynto/shared';

import type { Sql } from '../client.js';

/**
 * Server-side aggregates of the Analytics page and GET /api/v1/analytics/summary.
 *
 * Period = [from, to). Every scan created in the period counts, including
 * scans later replaced by a refresh (they are work that was done). Scores
 * are averaged over completed scans, per axis only where the axis was
 * evaluated: a disabled axis is absent from axis_scores, never a 0.
 *
 * Weeks are ISO weeks (Monday) in Europe/Paris.
 */

export interface AnalyticsRange {
  from: string;
  to: string;
}

export interface ActivityEvent {
  kind: 'created' | 'completed' | 'failed' | 'opened';
  at: string;
  audit_id: string;
  url: string;
  label: string | null;
  source: string;
}

const RULE_LABEL = new Map(AUDIT_RULES_META.map((r) => [r.code, r.description] as const));

function round1(n: number | null): number | null {
  return n === null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10;
}

export function createAnalyticsRepo(sql: Sql) {
  return {
    async summary(range: AnalyticsRange): Promise<ApiAnalyticsSummary> {
      const { from, to } = range;

      const [totals] = await sql<
        {
          total: number;
          completed: number;
          failed: number;
          in_progress: number;
          avg_score: number | null;
          good: number;
          fair: number;
          poor: number;
          llm_calls: number;
          tokens_in: number;
          tokens_out: number;
          vision_calls: number;
        }[]
      >`
        select count(*)::int as total,
               (count(*) filter (where status = 'completed'))::int as completed,
               (count(*) filter (where status = 'failed'))::int as failed,
               (count(*) filter (where status in ('queued', 'running')))::int as in_progress,
               avg(global_score * 10) filter (where status = 'completed' and global_score is not null)
                 as avg_score,
               -- Same bands as scoreBand() on the rounded /100 score: 80+ good, 50-79 fair.
               (count(*) filter (where status = 'completed' and round((global_score * 10)::numeric) >= 80))::int as good,
               (count(*) filter (where status = 'completed' and round((global_score * 10)::numeric) >= 50
                                 and round((global_score * 10)::numeric) < 80))::int as fair,
               (count(*) filter (where status = 'completed' and round((global_score * 10)::numeric) < 50))::int as poor,
               (count(*) filter (where llm_provider is not null and llm_error is null))::int as llm_calls,
               coalesce(sum(llm_tokens_in), 0)::int as tokens_in,
               coalesce(sum(llm_tokens_out), 0)::int as tokens_out,
               (count(*) filter (where facts -> 'vision' ->> 'fetched' = 'true'))::int as vision_calls
          from audits_full
         where created_at >= ${from} and created_at < ${to}
      `;

      const weekly = await sql<
        { week_start: string; completed: number; failed: number; in_progress: number }[]
      >`
        with weeks as (
          select generate_series(
            date_trunc('week', (${from}::timestamptz at time zone 'Europe/Paris')),
            date_trunc('week', ((${to}::timestamptz - interval '1 second') at time zone 'Europe/Paris')),
            interval '1 week'
          ) as w
        ),
        agg as (
          select date_trunc('week', created_at at time zone 'Europe/Paris') as w,
                 (count(*) filter (where status = 'completed'))::int as completed,
                 (count(*) filter (where status = 'failed'))::int as failed,
                 (count(*) filter (where status in ('queued', 'running')))::int as in_progress
            from audits_full
           where created_at >= ${from} and created_at < ${to}
           group by 1
        )
        select to_char(weeks.w, 'YYYY-MM-DD') as week_start,
               coalesce(agg.completed, 0) as completed,
               coalesce(agg.failed, 0) as failed,
               coalesce(agg.in_progress, 0) as in_progress
          from weeks left join agg on agg.w = weeks.w
         order by weeks.w
      `;

      const axisRows = await sql<{ axis: string; average: number | null; audits: number }[]>`
        select e.key as axis, avg((e.value ->> 'score')::numeric * 10) as average,
               count(*)::int as audits
          from audits_full a, jsonb_each(a.axis_scores) e
         where a.status = 'completed'
           and a.created_at >= ${from} and a.created_at < ${to}
           and jsonb_typeof(e.value -> 'score') = 'number'
         group by e.key
      `;
      const byAxis = new Map(axisRows.map((r) => [r.axis, r] as const));

      const [links] = await sql<{ total: number; opened: number; median_hours: number | null }[]>`
        with l as (
          select r.id, r.created_at, r.views_count,
                 (select min(v.viewed_at) from radar_audit_views v where v.radar_audit_id = r.id)
                   as first_view
            from radar_audits r
           where r.created_at >= ${from} and r.created_at < ${to}
        )
        select count(*)::int as total,
               (count(*) filter (where views_count > 0 or first_view is not null))::int as opened,
               percentile_cont(0.5) within group (
                 order by extract(epoch from (first_view - created_at)) / 3600.0
               ) filter (where first_view is not null) as median_hours
          from l
      `;

      const sources = await sql<{ source: string; count: number }[]>`
        select source, count(*)::int as count
          from audits_full
         where created_at >= ${from} and created_at < ${to}
         group by source
         order by count desc, source
      `;

      const top = await sql<{ rule_code: string; axis: string; count: number; title: string }[]>`
        select f.rule_code, min(f.axis) as axis, count(distinct f.audit_id)::int as count,
               mode() within group (order by f.title) as title
          from audit_findings_full f
          join audits_full a on a.id = f.audit_id
         where a.created_at >= ${from} and a.created_at < ${to}
         group by f.rule_code
         order by count desc, f.rule_code
         limit 10
      `;

      // Préparation IA: completed audits that ran the module (ai_score set),
      // and the tests that failed on the most of them.
      const [ai] = await sql<{ audits: number; avg: number | null; low: number }[]>`
        select count(*)::int as audits, avg(ai_score) as avg,
               (count(*) filter (where ai_score < ${AI_READINESS_LOW_THRESHOLD}))::int as low
          from audits_full
         where status = 'completed' and ai_score is not null
           and created_at >= ${from} and created_at < ${to}
      `;
      const aiFailed = await sql<{ check_id: string; count: number }[]>`
        select c ->> 'id' as check_id, count(distinct a.id)::int as count
          from audits_full a,
               jsonb_array_elements(a.ai_readiness -> 'checks') c
         where a.status = 'completed' and a.ai_score is not null
           and a.created_at >= ${from} and a.created_at < ${to}
           and c ->> 'status' = 'fail'
         group by 1
         order by count desc, check_id
         limit 10
      `;

      const t = totals ?? {
        total: 0,
        completed: 0,
        failed: 0,
        in_progress: 0,
        avg_score: null,
        good: 0,
        fair: 0,
        poor: 0,
        llm_calls: 0,
        tokens_in: 0,
        tokens_out: 0,
        vision_calls: 0,
      };
      const linkTotal = links?.total ?? 0;
      const opened = links?.opened ?? 0;
      const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

      return {
        period_days: days,
        from,
        to,
        audits: {
          total: t.total,
          completed: t.completed,
          failed: t.failed,
          in_progress: t.in_progress,
        },
        weekly: [...weekly],
        average_score: round1(t.avg_score),
        axes: ALL_AXES.map((axis: AuditAxis) => {
          const r = byAxis.get(axis);
          return { axis, average: round1(r?.average ?? null), audits: r?.audits ?? 0 };
        }),
        score_bands: [
          { band: 'good', count: t.good },
          { band: 'fair', count: t.fair },
          { band: 'poor', count: t.poor },
        ],
        links: {
          total: linkTotal,
          opened,
          open_rate: linkTotal > 0 ? Math.round((opened / linkTotal) * 1000) / 1000 : null,
          median_hours_to_first_open: round1(links?.median_hours ?? null),
        },
        sources: [...sources],
        top_findings: top.map((r) => ({
          rule_code: r.rule_code,
          axis: r.axis,
          count: r.count,
          label: (r.title.length > 0 ? r.title : RULE_LABEL.get(r.rule_code)) ?? r.rule_code,
        })),
        llm: {
          calls: t.llm_calls,
          tokens_in: t.tokens_in,
          tokens_out: t.tokens_out,
          vision_calls: t.vision_calls,
        },
        ai_readiness: {
          audits: ai?.audits ?? 0,
          average_score: round1(ai?.avg ?? null),
          low_count: ai?.low ?? 0,
          top_failed_checks: aiFailed.flatMap((r) => {
            const id = AiCheckIdSchema.safeParse(r.check_id);
            if (!id.success) return [];
            return [
              {
                check_id: id.data,
                rule_code: aiRuleCode(id.data),
                label: AI_CHECK_LABEL[id.data],
                count: r.count,
              },
            ];
          }),
        },
      };
    },

    /**
     * Chronological feed (newest first): audits created, finished, failed,
     * and tracking links opened. "completed" uses scanned_at; "failed" has no
     * own timestamp and uses the creation time.
     */
    async activity(limit = 50): Promise<ActivityEvent[]> {
      const n = Math.min(Math.max(limit, 1), 200);
      return sql<ActivityEvent[]>`
        select * from (
          select 'created' as kind, a.created_at as at, a.id as audit_id, a.url, a.label, a.source
            from audits_full a
          union all
          select 'completed', coalesce(a.scanned_at, a.created_at), a.id, a.url, a.label, a.source
            from audits_full a where a.status = 'completed'
          union all
          select 'failed', a.created_at, a.id, a.url, a.label, a.source
            from audits_full a where a.status = 'failed'
          union all
          select 'opened', v.viewed_at, a.id, a.url, a.label, a.source
            from radar_audit_views v
            join radar_audits r on r.id = v.radar_audit_id
            join audits_full a on a.id = r.audit_id
        ) e
        -- Same instant: the later lifecycle step first.
        order by at desc,
                 case kind when 'opened' then 3 when 'created' then 1 else 2 end desc
        limit ${n}
      `;
    },
  };
}

export type AnalyticsRepo = ReturnType<typeof createAnalyticsRepo>;
