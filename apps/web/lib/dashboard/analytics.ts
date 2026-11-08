/** Pure helpers of the Analytics page (unit-tested). */

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(raw: unknown): Period {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (PERIODS as readonly number[]).includes(n) ? (n as Period) : 30;
}

/** Clean axis maximum: 1, 2, 5 x 10^n, at least `min`. */
export function niceMax(value: number, min = 4): number {
  const v = Math.max(value, min);
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

/** "6 oct." for a YYYY-MM-DD week start. */
export function shortDay(isoDate: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

export function percent(ratio: number | null): string {
  if (ratio === null) return '-';
  return `${String(Math.round(ratio * 100))} %`;
}

/** Hours -> "45 min", "3,5 h", "2,1 j". */
export function duration(hours: number | null): string {
  if (hours === null) return '-';
  if (hours < 1) return `${String(Math.max(1, Math.round(hours * 60)))} min`;
  if (hours < 48) return `${(Math.round(hours * 10) / 10).toLocaleString('fr-FR')} h`;
  return `${(Math.round((hours / 24) * 10) / 10).toLocaleString('fr-FR')} j`;
}

/** 1 284 / 12,9 k / 4,2 M */
export function compact(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    notation: n >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(n);
}
