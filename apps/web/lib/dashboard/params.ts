/**
 * Dashboard list URL state (pure, unit-tested). Every filter lives in the
 * query string so views are shareable and the page stays a Server
 * Component.
 */

export const VIEWS = ['tous', 'en-cours', 'echecs', 'radar', 'mois'] as const;
export type DashboardView = (typeof VIEWS)[number];

export const STATUSES = ['en-cours', 'termine', 'echec', 'expire'] as const;
export type StatusParam = (typeof STATUSES)[number];

export const SORTS = ['recent', 'ancien', 'score-haut', 'score-bas'] as const;
export type SortParam = (typeof SORTS)[number];

/** `ia=faible`: Préparation IA score under AI_READINESS_LOW_THRESHOLD. */
export const AI_FILTERS = ['faible'] as const;
export type AiFilterParam = (typeof AI_FILTERS)[number];

export const PAGE_SIZE = 25;

export interface ListParams {
  vue: DashboardView;
  q: string;
  statut: StatusParam | null;
  tri: SortParam;
  /** YYYY-MM or null. */
  mois: string | null;
  /** Préparation IA filter. */
  ia: AiFilterParam | null;
  page: number;
}

type Raw = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(list: readonly T[], v: string | undefined): T | null {
  return v !== undefined && (list as readonly string[]).includes(v) ? (v as T) : null;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseListParams(raw: Raw): ListParams {
  const q = (first(raw.q) ?? '').trim().slice(0, 200);
  const mois = first(raw.mois);
  const page = Number.parseInt(first(raw.page) ?? '1', 10);
  return {
    vue: oneOf(VIEWS, first(raw.vue)) ?? 'tous',
    q,
    statut: oneOf(STATUSES, first(raw.statut)),
    tri: oneOf(SORTS, first(raw.tri)) ?? 'recent',
    mois: mois !== undefined && MONTH.test(mois) ? mois : null,
    ia: oneOf(AI_FILTERS, first(raw.ia)),
    page: Number.isFinite(page) && page >= 1 && page <= 10_000 ? page : 1,
  };
}

/** [start, end) of a YYYY-MM month in UTC, as ISO strings. */
export function monthBounds(month: string): { from: string; to: string } {
  const m = MONTH.exec(month);
  if (!m) throw new Error('invalid month');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return {
    from: new Date(Date.UTC(y, mo - 1, 1)).toISOString(),
    to: new Date(Date.UTC(y, mo, 1)).toISOString(),
  };
}

export function currentMonth(now: Date = new Date()): string {
  return `${String(now.getUTCFullYear())}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const m = MONTH.exec(month);
  if (!m) throw new Error('invalid month');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + delta, 1));
  return currentMonth(d);
}

export interface RepoFilter {
  q: string | null;
  status: 'in_progress' | 'completed' | 'failed' | 'expired' | null;
  source: 'radar' | null;
  createdFrom: string | null;
  createdTo: string | null;
  aiLow: boolean;
  sort: 'created_desc' | 'created_asc' | 'score_desc' | 'score_asc';
  limit: number;
  offset: number;
}

const STATUS_TO_REPO = {
  'en-cours': 'in_progress',
  termine: 'completed',
  echec: 'failed',
  expire: 'expired',
} as const;

const SORT_TO_REPO = {
  recent: 'created_desc',
  ancien: 'created_asc',
  'score-haut': 'score_desc',
  'score-bas': 'score_asc',
} as const;

/** Combines the saved view with the explicit filters (explicit wins). */
export function toRepoFilter(p: ListParams, now: Date = new Date()): RepoFilter {
  let status: RepoFilter['status'] = p.statut ? STATUS_TO_REPO[p.statut] : null;
  if (status === null && p.vue === 'en-cours') status = 'in_progress';
  if (status === null && p.vue === 'echecs') status = 'failed';
  const month = p.mois ?? (p.vue === 'mois' ? currentMonth(now) : null);
  const bounds = month ? monthBounds(month) : null;
  return {
    q: p.q.length > 0 ? p.q : null,
    status,
    source: p.vue === 'radar' ? 'radar' : null,
    createdFrom: bounds?.from ?? null,
    createdTo: bounds?.to ?? null,
    aiLow: p.ia === 'faible',
    sort: SORT_TO_REPO[p.tri],
    limit: PAGE_SIZE,
    offset: (p.page - 1) * PAGE_SIZE,
  };
}

/** Query string for a list URL, dropping defaults. */
export function listQuery(p: Partial<ListParams>): string {
  const qs = new URLSearchParams();
  if (p.vue && p.vue !== 'tous') qs.set('vue', p.vue);
  if (p.q) qs.set('q', p.q);
  if (p.statut) qs.set('statut', p.statut);
  if (p.tri && p.tri !== 'recent') qs.set('tri', p.tri);
  if (p.mois) qs.set('mois', p.mois);
  if (p.ia) qs.set('ia', p.ia);
  if (p.page && p.page > 1) qs.set('page', String(p.page));
  const s = qs.toString();
  return s.length > 0 ? `?${s}` : '';
}
