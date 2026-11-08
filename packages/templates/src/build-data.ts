import {
  AI_CHECK_CATEGORIES,
  AI_CHECK_CATEGORY_LABEL,
  AI_CHECK_DESCRIPTION,
  AI_CHECK_LABEL,
  AI_CHECK_STATUS_LABEL,
  AI_SITE_TYPE_LABEL,
  AUDIT_RULES_META,
  disabledAxes,
  type AiCheckResult,
  type AuditAxis,
  type AuditFullFinding,
  type AuditFullResult,
} from '@mynto/shared';

import { ensureContrast, isHexColor, readableOn } from './color.js';
import {
  BAND_LABEL,
  REPORT_DATA_CONTRACT,
  REPORT_DATA_VERSION,
  SECTION_LABEL,
  scoreBand,
  type ReportAi,
  type ReportAxis,
  type ReportDataV1,
  type ReportFinding,
} from './contract.js';
import type { SectionEntry, SettingValue } from './manifest.js';

/** Report order of the 8 axes. */
export const REPORT_AXIS_ORDER: readonly AuditAxis[] = [
  'seo_technique',
  'performance',
  'accessibilite',
  'conformite',
  'conversion',
  'seo_contenu',
  'ux',
  'ui',
];

export const AXIS_LABEL: Record<AuditAxis, string> = {
  seo_technique: 'SEO technique',
  seo_contenu: 'SEO contenu',
  performance: 'Performance',
  accessibilite: 'Accessibilité',
  conformite: 'Conformité légale',
  conversion: 'Conversion',
  ux: 'UX',
  ui: 'UI',
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

const SEVERITY_LABEL = { P0: 'Critique', P1: 'Important', P2: 'À améliorer', P3: 'Détail' };
const EFFORT_LABEL = { quick_win: 'Rapide', standard: 'Standard', important: 'Chantier' };
const SEVERITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

export interface BuildAgency {
  name: string;
  websiteUrl: string | null;
  contactUrl: string | null;
  logoUrl: string | null;
  color: string;
  footer: string | null;
}

export interface BuildContext {
  mode: 'web' | 'print';
  shareUrl: string;
  pdfUrl: string;
  tracking: boolean;
  label?: string | null;
  faviconUrl?: string | null;
  now?: Date;
}

export interface BuildTemplate {
  id: string;
  name: string;
  version: string;
  values: Record<string, SettingValue>;
  sections: SectionEntry[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function siteName(url: string, label: string | null | undefined): string {
  if (label && label.trim().length > 0) return label.trim();
  return hostOf(url);
}

export function frDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(d);
}

export function frNumber(n: number, digits = 0): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n);
}

function score100(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, Math.round(v * 10)));
}

function scoreObj(value: number | null): ReportAxis['score'] {
  const band = scoreBand(value);
  return { value, band, band_label: band ? BAND_LABEL[band] : 'Non évalué' };
}

function str(v: SettingValue | undefined, fallback: string): string {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : fallback;
}

function anchorFor(prefix: string, id: string): string {
  return `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60)}`;
}

function toFinding(f: AuditFullFinding, showCode: boolean): ReportFinding {
  const urls = f.affected_urls.filter((u) => /^https?:\/\//.test(u));
  return {
    id: f.id,
    anchor: anchorFor('pb', f.id),
    axis: f.axis,
    axis_label: AXIS_LABEL[f.axis],
    severity: f.severity,
    severity_label: SEVERITY_LABEL[f.severity],
    effort: f.effort,
    effort_label: f.effort ? EFFORT_LABEL[f.effort] : null,
    title: f.title,
    constat: f.narrative_constat,
    impact: f.narrative_impact_business,
    recommendation: f.narrative_recommandation,
    code: showCode && f.narrative_code_snippet?.trim() ? f.narrative_code_snippet : null,
    legal_refs: f.legal_refs.map((r) => ({
      label: r.label,
      url: r.url && /^https?:\/\//.test(r.url) ? r.url : null,
    })),
    urls: urls.slice(0, 10),
    urls_more: Math.max(0, urls.length - 10),
  };
}

function buildAi(audit: AuditFullResult): ReportAi {
  const ai = audit.ai_readiness ?? null;
  const empty: ReportAi = {
    evaluated: false,
    failed: false,
    score: scoreObj(null),
    anchor: 'preparation-ia',
    level: null,
    level_name: null,
    max_level: null,
    site_type_label: null,
    site_type_auto: false,
    included_in_global_score: false,
    counts: { pass: 0, fail: 0, other: 0 },
    categories: [],
    top_fixes: [],
  };
  if (ai === null) return empty;
  const toCheck = (c: AiCheckResult): ReportAi['top_fixes'][number] => ({
    id: c.id,
    label: AI_CHECK_LABEL[c.id],
    description: AI_CHECK_DESCRIPTION[c.id],
    status: c.status,
    status_label: c.applicable === false ? 'Non applicable' : AI_CHECK_STATUS_LABEL[c.status],
    applicable: c.applicable !== false,
    message: c.message,
    fix: c.status === 'fail' ? (c.fixPrompt ?? null) : null,
    weight: c.weight,
  });
  const checks = ai.checks.map(toCheck);
  return {
    ...empty,
    evaluated: true,
    failed: ai.status === 'failed',
    score: scoreObj(ai.status === 'completed' ? ai.score : null),
    level: ai.level,
    level_name: ai.level_name,
    max_level: ai.max_level,
    site_type_label: AI_SITE_TYPE_LABEL[ai.site_type],
    site_type_auto: ai.site_type_auto,
    included_in_global_score: ai.included_in_global_score,
    counts: {
      pass: checks.filter((c) => c.status === 'pass').length,
      fail: checks.filter((c) => c.status === 'fail' && c.applicable).length,
      other: checks.filter((c) => !(c.status === 'pass' || (c.status === 'fail' && c.applicable)))
        .length,
    },
    categories: AI_CHECK_CATEGORIES.map((cat) => ({
      id: cat,
      label: AI_CHECK_CATEGORY_LABEL[cat],
      checks: ai.checks.filter((c) => c.category === cat && c.applicable !== false).map(toCheck),
    })).filter((c) => c.checks.length > 0),
    top_fixes: checks
      .filter((c) => c.status === 'fail' && c.applicable)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 5),
  };
}

interface FactsLite {
  lighthouse?: { fetched?: boolean };
  axe?: { fetched?: boolean };
  internalPagesCrawled?: unknown[];
}

/**
 * Builds the report-data v1 object from a completed audit. Pure function:
 * the web app, the PDF, the CLI and the MCP preview all go through it.
 */
export function buildReportData(input: {
  audit: AuditFullResult;
  findings: AuditFullFinding[];
  agency: BuildAgency;
  context: BuildContext;
  template: BuildTemplate;
}): ReportDataV1 {
  const { audit, agency, context, template } = input;
  const v = template.values;
  const showCode = v.show_code !== false;
  const openMode = typeof v.open_issues === 'string' ? v.open_issues : 'p0';
  const facts = (audit.facts ?? {}) as FactsLite;
  const ran = { lighthouse: Boolean(facts.lighthouse?.fetched), axe: Boolean(facts.axe?.fetched) };

  const findings = [...input.findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
  const all = findings.map((f) => toFinding(f, showCode));
  const notEvaluated = new Set(disabledAxes(audit.modules ?? null));
  const emitted = new Set(findings.map((f) => f.rule_code));
  const scoreMap = new Map(Object.entries(audit.axis_scores));

  const axes: ReportAxis[] = REPORT_AXIS_ORDER.map((axis) => {
    const raw = scoreMap.get(axis);
    const evaluated =
      !notEvaluated.has(axis) && typeof raw?.score === 'number' && Number.isFinite(raw.score);
    const value = evaluated ? score100(raw.score) : null;
    const list = all.filter((f) => f.axis === axis);
    const p0 = list.filter((f) => f.severity === 'P0').length;
    const passed = evaluated
      ? AUDIT_RULES_META.filter(
          (m) =>
            m.axis === axis &&
            !emitted.has(m.code) &&
            !(m.requiredCollector && !ran[m.requiredCollector]) &&
            !(m.requiresHeavyCollector && !ran.lighthouse && !ran.axe),
        ).map((m) => m.passedLabel)
      : [];
    return {
      id: axis,
      label: AXIS_LABEL[axis],
      short: AXIS_SHORT[axis],
      anchor: `axe-${axis.replace(/_/g, '-')}`,
      evaluated,
      score: scoreObj(value),
      findings_count: list.length,
      p0_count: p0,
      open_by_default:
        context.mode === 'print' || openMode === 'all' || (openMode === 'p0' && p0 > 0),
      findings: list,
      passed,
    };
  });

  const counts = {
    P0: all.filter((f) => f.severity === 'P0').length,
    P1: all.filter((f) => f.severity === 'P1').length,
    P2: all.filter((f) => f.severity === 'P2').length,
    P3: all.filter((f) => f.severity === 'P3').length,
    total: all.length,
  };

  const byId = new Map(all.map((f) => [f.id, f]));
  const priorities = audit.top3_priorities.slice(0, 3).map((p, i) => {
    const ids = p.findingIds ?? (p.findingId ? [p.findingId] : []);
    return {
      rank: i + 1,
      title: p.title,
      reason: p.reason,
      expected_outcome: p.expectedOutcome ?? null,
      findings: ids
        .map((id) => byId.get(id))
        .filter((f): f is ReportFinding => f !== undefined)
        .map((f) => ({ id: f.id, anchor: f.anchor, title: f.title, severity: f.severity })),
    };
  });

  const ce = audit.cost_estimate ?? null;
  const rem = audit.remediation ?? null;
  const cost: ReportDataV1['cost'] =
    ce === null || ce.totalMinutes <= 0
      ? null
      : {
          days: ce.totalDays,
          days_label: `${frNumber(Math.round(ce.totalDays * 2) / 2, 1)} jour${ce.totalDays > 1 ? 's' : ''}`,
          amount_low: ce.amountEurLow,
          amount_high: ce.amountEurHigh,
          amount_label: `${frNumber(ce.amountEurLow)} € à ${frNumber(ce.amountEurHigh)} € HT`,
          daily_rate: ce.dailyRateEur,
          daily_rate_label: `${frNumber(ce.dailyRateEur)} € HT par jour`,
          items_count: ce.items.length,
          verdict: rem?.mode ?? null,
          verdict_label:
            rem === null
              ? null
              : rem.mode === 'redesign_only'
                ? 'Une refonte est plus adaptée qu’une correction.'
                : 'Correction ciblée possible, refonte à envisager selon tes objectifs.',
          redesign_reasons: rem?.redesignReasons ?? [],
          disclaimer: ce.disclaimer,
        };

  const color = isHexColor(agency.color) ? agency.color.toLowerCase() : '#2563eb';
  const fixed = ensureContrast(color);
  const evaluatedAxes = axes.filter((a) => a.evaluated).length;
  const global = score100(audit.global_score);
  const host = hostOf(audit.url);

  const passed = axes.flatMap((a) => a.passed.map((label) => ({ axis_label: a.label, label })));

  const sections = template.sections.map((s) => ({
    id: s.id,
    label: SECTION_LABEL[s.id],
    enabled: s.enabled,
  }));

  const now = context.now ?? new Date();
  return {
    contract: REPORT_DATA_CONTRACT,
    version: REPORT_DATA_VERSION,
    mode: context.mode,
    generated_at: now.toISOString(),
    audit: {
      slug: audit.slug,
      url: audit.url,
      host,
      name: siteName(audit.url, context.label),
      created_at: audit.created_at,
      created_label: frDate(audit.created_at),
      expires_at: audit.expires_at,
      expires_label: frDate(audit.expires_at),
      sector: audit.sector,
      main_kpi: audit.main_kpi,
      stack: audit.stack,
      hero_image_url: audit.hero_screenshot_url ?? null,
      favicon_url: context.faviconUrl ?? null,
      pages_analyzed: Array.isArray(facts.internalPagesCrawled)
        ? facts.internalPagesCrawled.length + 1
        : null,
      llm_assisted: audit.llm_model !== null,
    },
    score: {
      ...scoreObj(global),
      evaluated_axes: evaluatedAxes,
      total_axes: axes.length,
      partial: evaluatedAxes < axes.length,
      ai_included: audit.ai_readiness?.included_in_global_score === true,
    },
    counts,
    summary: { text: audit.exec_summary, impact: audit.estimated_impact_narrative },
    priorities,
    quick_wins: audit.quick_wins.slice(0, 8),
    cost,
    axes,
    top_issues: all.filter((f) => f.severity === 'P0' || f.severity === 'P1').slice(0, 6),
    ai: buildAi(audit),
    passed,
    agency: {
      name: agency.name,
      initial: agency.name.trim().charAt(0).toUpperCase() || 'A',
      website_url: agency.websiteUrl,
      website_host: agency.websiteUrl ? hostOf(agency.websiteUrl) : null,
      contact_url: agency.contactUrl,
      logo_url: agency.logoUrl,
      color,
      color_text: fixed.color,
      color_adjusted: fixed.adjusted,
      on_color: readableOn(color),
      footer: agency.footer,
    },
    links: { share_url: context.shareUrl, pdf_url: context.pdfUrl },
    tracking: {
      enabled: context.tracking,
      notice: `${agency.name} sait si tu as ouvert ce rapport, rien de plus.`,
    },
    texts: {
      intro: str(v.intro, '') || null,
      cta_title: str(v.cta_title, `Tu veux qu’on corrige ça ensemble ?`),
      cta_text: str(
        v.cta_text,
        `${agency.name} peut prendre en charge les priorités de ce rapport. Un échange de 20 minutes suffit pour cadrer.`,
      ),
      cta_label: str(v.cta_label, 'Prendre contact'),
      footer: str(v.footer_text, '') || agency.footer,
      disclaimer:
        'Rapport automatisé, à titre indicatif. Les estimations sont à confirmer avec tes données réelles.',
    },
    sections,
    settings: { ...v },
    template: { id: template.id, name: template.name, version: template.version },
  };
}
