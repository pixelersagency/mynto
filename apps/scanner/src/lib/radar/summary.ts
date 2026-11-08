import { z } from 'zod';

/**
 * Pure mappers for the Radar API responses. No LLM text here: Radar's
 * agent writes its own talking points from the raw scores and the
 * deterministic finding titles.
 */

export type AuditFullStatus = 'queued' | 'running' | 'completed' | 'failed';
export type RadarStatus = 'pending' | 'running' | 'done' | 'failed';

export function toRadarStatus(status: string): RadarStatus {
  switch (status) {
    case 'completed':
      return 'done';
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    default:
      return 'pending';
  }
}

/** 0-10 score with one decimal -> 0-100 integer. Null while not scored. */
export function toGlobalScore100(globalScore: number | string | null | undefined): number | null {
  if (globalScore === null || globalScore === undefined) return null;
  // numeric columns may come back as strings depending on the driver config.
  const n = typeof globalScore === 'string' ? Number(globalScore) : globalScore;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10)));
}

const AxisScoresLooseSchema = z.record(
  z.string(),
  z.object({ score: z.coerce.number() }).passthrough(),
);

/** `{ axis: { score, band, weight } }` -> `{ axis: score }` (0-10). */
export function axesFromScores(raw: unknown): Record<string, number> {
  const parsed = AxisScoresLooseSchema.safeParse(raw);
  if (!parsed.success) return {};
  const out: Record<string, number> = {};
  for (const [axis, entry] of Object.entries(parsed.data)) {
    if (Number.isFinite(entry.score)) out[axis] = entry.score;
  }
  return out;
}

export const SummaryFindingRowSchema = z.object({
  axis: z.string(),
  severity: z.enum(['P0', 'P1', 'P2', 'P3']),
  title: z.string(),
});
export type SummaryFinding = z.infer<typeof SummaryFindingRowSchema>;

const SEVERITY_ORDER: Record<SummaryFinding['severity'], number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const MAX_SUMMARY_FINDINGS = 15;

/**
 * Deterministic list: severity first, then axis, then title, so two calls
 * on the same audit always return the same 15 items in the same order.
 */
export function summarizeFindings(rows: unknown[]): SummaryFinding[] {
  const out: SummaryFinding[] = [];
  for (const row of rows) {
    const parsed = SummaryFindingRowSchema.safeParse(row);
    if (parsed.success) {
      out.push({
        axis: parsed.data.axis,
        severity: parsed.data.severity,
        title: parsed.data.title,
      });
    }
  }
  out.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.axis.localeCompare(b.axis) ||
      a.title.localeCompare(b.title),
  );
  return out.slice(0, MAX_SUMMARY_FINDINGS);
}
