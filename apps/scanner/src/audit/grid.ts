import type { AuditAxis, Severity } from './types.js';

/**
 * Closed-grid UI/UX rubric — the answer to the "site daté
 * alors qu'il est clean" false positive.
 *
 * Instead of letting the vision LLM emit a free 0-10 score that the code
 * then thresholds (the LLM acting as judge), the LLM marks each named
 * criterion on a 3-state scale with a MANDATORY justification pulled from
 * the screenshot. Two guard-rails:
 *
 *   - Justification obligatoire : no rating without pointing at a concrete
 *     element. Kills invention ("daté" without saying what is dated).
 *   - Droit au neutre : `neutre` is the default. A criterion only goes
 *     `probleme` when clearly problematic, only `bon` when clearly good.
 *     This is what tues the false positive on clean-but-plain sites.
 *
 * One config table drives the Gemini prompt, the response schema, AND the
 * rules, so they can never drift apart.
 */

export type GridRating = 'bon' | 'neutre' | 'probleme';

export const GRID_RATINGS: readonly GridRating[] = ['bon', 'neutre', 'probleme'];

export type GridCriterionKey =
  | 'hierarchie_visuelle'
  | 'coherence_typographique'
  | 'coherence_couleurs'
  | 'densite_espacement'
  | 'qualite_images'
  | 'traitement_cta'
  | 'coherence_composants'
  | 'impression_modernite'
  | 'navigation_clarte';

export interface GridCriterionEntry {
  key: GridCriterionKey;
  rating: GridRating;
  /** Concrete element from the screenshot backing the rating. Required by
   * the prompt; empty string tolerated by the schema so a stubborn LLM
   * response still parses (the rule just won't have evidence text). */
  justification: string;
  /** Location in a bounded screenshot, required before emitting a qualitative issue. */
  viewport?: 'desktop' | 'mobile';
  region?: string;
}

export interface GridCriterionDef {
  key: GridCriterionKey;
  /** FR label shown in the report. */
  label: string;
  /** Axis the resulting finding belongs to. */
  axis: AuditAxis;
  /** Rule code emitted when this criterion is rated `probleme`. */
  ruleCode: string;
  /** Severity of the qualitative finding. */
  severity: Severity;
  /** One-line guidance injected into the prompt for this criterion. */
  promptHint: string;
}

/**
 * The 8 UI criteria + navigation clarity routed
 * to the UX axis. ALL findings derived from these are `qualitative`: they
 * never penalise the mechanical score and never get costed in days — they
 * are the expert-analysis arguments that justify a redesign.
 */
export const GRID_CRITERIA: readonly GridCriterionDef[] = [
  {
    key: 'hierarchie_visuelle',
    label: 'Hiérarchie visuelle',
    axis: 'ui',
    ruleCode: 'ui.visual_hierarchy.weak',
    severity: 'P2',
    promptHint:
      'Progression claire titre → sous-titre → CTA → preuve ? On voit immédiatement ce qui compte ?',
  },
  {
    key: 'coherence_typographique',
    label: 'Cohérence typographique',
    axis: 'ui',
    ruleCode: 'ui.typography.incoherent',
    severity: 'P3',
    promptHint:
      'Polices, tailles et graisses forment-elles un système cohérent ? Pas de mélange anarchique ?',
  },
  {
    key: 'coherence_couleurs',
    label: 'Cohérence des couleurs',
    axis: 'ui',
    ruleCode: 'ui.colors.incoherent',
    severity: 'P3',
    promptHint:
      'Les couleurs empêchent-elles visiblement de distinguer une information ou une action ? Une palette expressive ou abondante ne constitue pas un défaut.',
  },
  {
    key: 'densite_espacement',
    label: 'Densité et espacement',
    axis: 'ui',
    ruleCode: 'ui.spacing.poor',
    severity: 'P2',
    promptHint:
      'Décrire uniquement des chevauchements, coupures ou regroupements ambigus visibles. Une grille ou un rythme particulier ne sont pas obligatoires.',
  },
  {
    key: 'qualite_images',
    label: 'Qualité et cohérence des images',
    axis: 'ui',
    ruleCode: 'ui.images.poor',
    severity: 'P2',
    promptHint:
      'Une coupure ou dégradation visible empêche-t-elle de comprendre une image informative ? Un choix artistique ou une image de stock ne prouve pas un défaut.',
  },
  {
    key: 'traitement_cta',
    label: 'Traitement des CTA',
    axis: 'ui',
    ruleCode: 'ui.cta.weak',
    severity: 'P2',
    promptHint:
      'CTA principaux identifiables, contrastés, traités comme des boutons d’action clairs ? Ou noyés / ambigus ?',
  },
  {
    key: 'coherence_composants',
    label: 'Cohérence des composants',
    axis: 'ui',
    ruleCode: 'ui.brand.inconsistent',
    severity: 'P2',
    promptHint:
      'Boutons, cartes, champs partagent-ils un langage visuel commun (rayons, ombres, bordures) ? Ou bric-à-brac ?',
  },
  {
    key: 'impression_modernite',
    label: 'Impression de modernité',
    axis: 'ui',
    ruleCode: 'ui.design.dated_for_sector',
    severity: 'P1',
    promptHint:
      'Toujours neutre : le style et la modernité apparente ne prouvent pas une difficulté d’usage.',
  },
  {
    key: 'navigation_clarte',
    label: 'Clarté de navigation',
    axis: 'ux',
    ruleCode: 'ux.navigation.unclear',
    severity: 'P2',
    promptHint:
      'Évaluer seulement la lisibilité et le sens des libellés visibles. Aucun verdict sur le fonctionnement, les parcours, le clavier ou un menu fermé.',
  },
];

export const GRID_CRITERION_KEYS: readonly GridCriterionKey[] = GRID_CRITERIA.map((c) => c.key);

/** Lookup a grid entry by key from a (possibly partial) grid array. */
export function findGridEntry(
  grid: readonly GridCriterionEntry[],
  key: GridCriterionKey,
): GridCriterionEntry | null {
  return grid.find((e) => e.key === key) ?? null;
}
