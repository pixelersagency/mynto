/** Score helpers shared by the dashboard, the reports and the API (scores on 100). */

/** Stored global/axis score 0-10 -> integer /100, null when missing. */
export function score100(score: number | null | undefined): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.max(0, Math.min(100, Math.round(score * 10)));
}

export type ScoreBand = 'good' | 'fair' | 'poor';

/** 80-100 bon, 50-79 à améliorer, 0-49 critique. */
export function scoreBand(value: number): ScoreBand {
  if (value >= 80) return 'good';
  if (value >= 50) return 'fair';
  return 'poor';
}

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  good: 'bon',
  fair: 'à améliorer',
  poor: 'critique',
};

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
