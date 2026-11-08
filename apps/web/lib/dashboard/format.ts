import { disabledAxes, parseStoredModules, type AuditAxis } from '@mynto/shared';

import { hostOf, score100 } from '../scores';

/** Pure display helpers of the dashboard (unit-tested). */

export type DisplayStatus = 'completed' | 'running' | 'failed' | 'expired';

export function displayStatus(status: string, expiresAt: string, now = Date.now()): DisplayStatus {
  if (Date.parse(expiresAt) <= now) return 'expired';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'running';
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  completed: 'Terminé',
  running: 'En cours',
  failed: 'Échec',
  expired: 'Expiré',
};

export const AXIS_SHORT: Record<AuditAxis, string> = {
  seo_technique: 'SEO tech',
  seo_contenu: 'Contenu',
  performance: 'Perf',
  accessibilite: 'A11y',
  conformite: 'Conformité',
  conversion: 'Conversion',
  ux: 'UX',
  ui: 'UI',
};

export const AXIS_LONG: Record<AuditAxis, string> = {
  seo_technique: 'SEO technique',
  seo_contenu: 'SEO contenu',
  performance: 'Performance',
  accessibilite: 'Accessibilité',
  conformite: 'Conformité légale',
  conversion: 'Conversion',
  ux: 'UX',
  ui: 'UI',
};

export { SCORE_BAND_LABEL, score100, scoreBand, type ScoreBand } from '../scores';

const AXES: readonly AuditAxis[] = [
  'seo_technique',
  'seo_contenu',
  'performance',
  'accessibilite',
  'conformite',
  'conversion',
  'ux',
  'ui',
];

/** Weakest axes (score below 6/10), lowest first, at most `max`. */
export function weakAxes(axisScores: unknown, max = 3): AuditAxis[] {
  if (typeof axisScores !== 'object' || axisScores === null) return [];
  const rec = axisScores as Record<string, unknown>;
  const scored: { axis: AuditAxis; score: number }[] = [];
  for (const axis of AXES) {
    const v = rec[axis];
    const score =
      typeof v === 'object' && v !== null ? (v as { score?: unknown }).score : undefined;
    if (typeof score === 'number' && Number.isFinite(score) && score < 6) {
      scored.push({ axis, score });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, max)
    .map((s) => s.axis);
}

export { hostOf };

/** Name shown in the Site column: the label, otherwise a readable host. */
export function siteName(url: string, label: string | null): string {
  if (label !== null && label.trim().length > 0) return label.trim();
  const host = hostOf(url);
  const base = host.split('.').slice(0, -1).join('.') || host;
  return base
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const SOURCE_LABEL: Record<string, string> = {
  dashboard: 'Tableau de bord',
  radar: 'Radar',
  api: 'API',
  mcp: 'MCP',
  web: 'Ancien formulaire',
};

/** "6 novembre 2026" */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

/** Public URL of a report: tracking link when one exists, else the slug page. */
export function reportUrl(
  base: string,
  row: { tracking_token: string | null; slug: string },
): string {
  const root = base.replace(/\/+$/, '');
  return row.tracking_token ? `${root}/r/${row.tracking_token}` : `${root}/audit/full/${row.slug}`;
}

/** Same report for the agency itself: `?preview=1` never counts as an opening. */
export function previewPath(row: { tracking_token: string | null; slug: string }): string {
  return row.tracking_token
    ? `/r/${row.tracking_token}?preview=1`
    : `/audit/full/${row.slug}?preview=1`;
}

const CSV_FORMULA = /^[=+\-@\t\r]/;

/** RFC 4180 cell, neutralising spreadsheet formulas (CSV injection). */
export function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (typeof value === 'string' && CSV_FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Préparation IA cell of the audits table. */
export type AiScoreView =
  | { state: 'scored'; value: number }
  | { state: 'failed' }
  | { state: 'off' };

/**
 * `off` = module not run for this audit ("Non évalué"), `failed` = the run
 * measured nothing (origin unreachable), never shown as a 0.
 */
export function aiScoreView(aiScore: number | null, aiStatus: string | null): AiScoreView {
  if (aiStatus === 'completed' && typeof aiScore === 'number' && Number.isFinite(aiScore)) {
    return { state: 'scored', value: Math.max(0, Math.min(100, Math.round(aiScore))) };
  }
  if (aiStatus === 'failed') return { state: 'failed' };
  return { state: 'off' };
}

/** Change of the global score since the previous scan, on 100 (null when first scan). */
export function scoreDelta(current: number | null, previous: number | null): number | null {
  const a = score100(current);
  const b = score100(previous);
  if (a === null || b === null) return null;
  return a - b;
}

export interface AxisBar {
  axis: AuditAxis;
  label: string;
  /** Score on 100, null when the axis was not evaluated. */
  value: number | null;
}

/** The 8 axes in canonical order with their score on 100 (mini bars, radar). */
export function axisBars(axisScores: unknown, modules: unknown): AxisBar[] {
  const rec =
    typeof axisScores === 'object' && axisScores !== null
      ? (axisScores as Record<string, unknown>)
      : {};
  const off = new Set(
    modules === null || modules === undefined ? [] : disabledAxes(parseStoredModules(modules)),
  );
  return AXES.map((axis) => {
    const v = rec[axis];
    const raw = typeof v === 'object' && v !== null ? (v as { score?: unknown }).score : undefined;
    return {
      axis,
      label: AXIS_LONG[axis],
      value: off.has(axis) || typeof raw !== 'number' ? null : score100(raw),
    };
  });
}

export const PROGRESS_LABEL = {
  queued: 'En file',
  loading: 'Chargement',
  analysis: 'Analyse',
  writing: 'Rédaction',
} as const;
export type ProgressStep = keyof typeof PROGRESS_LABEL;

/** "acme.fr", "https://acme.fr/x" -> host, else null. */
export function urlCandidate(q: string): string | null {
  const v = q.trim();
  if (v.length < 4 || /\s/.test(v)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return /\.[a-z]{2,}$/i.test(u.hostname) ? u.hostname.replace(/^www\./, '') : null;
  } catch {
    return null;
  }
}
