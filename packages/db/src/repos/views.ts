import type { Sql } from '../client.js';

export interface InsertAuditViewInput {
  auditId: string;
  /** Coarse browser family ("Chrome, mobile"), never the raw User-Agent. */
  userAgentFamily: string | null;
  ipHash: string | null;
}

/**
 * audit_views rows are only read for the 30-minute dedupe of report views;
 * the daily purge drops them after this many days (RGPD: no IP hash kept
 * longer than needed).
 */
export const AUDIT_VIEWS_RETENTION_DAYS = 90;

/** audit_views: SSR views of public reports (no country, UA family only, since 0006). */
export function createViewsRepo(sql: Sql) {
  return {
    /** True when this ip_hash already viewed this audit since `sinceIso`. */
    async hasRecentView(auditId: string, ipHash: string, sinceIso: string): Promise<boolean> {
      const rows = await sql`
        select 1 from audit_views
         where audit_id = ${auditId} and ip_hash = ${ipHash} and viewed_at >= ${sinceIso}
         limit 1
      `;
      return rows.length > 0;
    },

    /** Daily purge: deletes the views older than `days`. Returns the row count. */
    async purgeOld(days: number = AUDIT_VIEWS_RETENTION_DAYS): Promise<number> {
      const rows = await sql`
        delete from audit_views where viewed_at < now() - make_interval(days => ${days}::int)
      `;
      return rows.count;
    },

    async insert(input: InsertAuditViewInput): Promise<void> {
      await sql`
        insert into audit_views (audit_id, user_agent, ip_hash)
        values (${input.auditId}, ${input.userAgentFamily?.slice(0, 200) ?? null}, ${input.ipHash})
      `;
    },
  };
}

export type ViewsRepo = ReturnType<typeof createViewsRepo>;
