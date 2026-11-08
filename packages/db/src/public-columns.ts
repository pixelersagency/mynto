/**
 * Column allowlists for PUBLIC read paths (report pages, public API).
 *
 * In the hosted product these were enforced by column GRANTs to the anon
 * role. Self-hosted there is a single DB role, so the guarantee lives here:
 * public reads select exactly these columns and nothing else. A unit test
 * asserts that none of them is private.
 */

/** Never returned by a public read. */
export const PRIVATE_AUDIT_COLUMNS = [
  'email',
  'llm_input',
  'source',
  'llm_status',
  'llm_error',
  'llm_tokens_in',
  'llm_tokens_out',
  'interpreted_at',
] as const;

/** Report summary (scanner GET /api/audits/full/:slug). */
export const PUBLIC_AUDIT_SUMMARY_COLUMNS = [
  'slug',
  'url',
  'status',
  'scanned_at',
  'stack',
  'stack_confidence',
  'sector',
  'sector_confidence',
  'main_kpi',
  'secondary_kpi',
  'global_score',
  'global_band',
  'axis_scores',
  'exec_summary',
  'top3_priorities',
  'quick_wins',
  'killer_findings',
  'estimated_impact_narrative',
  'llm_provider',
  'llm_model',
  'llm_duration_ms',
  'created_at',
  'expires_at',
  'modules',
  'ai_score',
] as const;

/** Full public report (web report page, PDF, OG image). */
export const PUBLIC_AUDIT_COLUMNS = [
  ...PUBLIC_AUDIT_SUMMARY_COLUMNS,
  'facts',
  'hero_screenshot_key',
  'cost_estimate',
  'remediation',
  'ai_readiness',
] as const;

export const PUBLIC_FINDING_COLUMNS = [
  'id',
  'rule_code',
  'axis',
  'severity',
  'effort',
  'title',
  'evidence',
  'affected_urls',
  'legal_refs',
  'narrative_constat',
  'narrative_impact_business',
  'narrative_recommandation',
  'narrative_code_snippet',
  'created_at',
] as const;
