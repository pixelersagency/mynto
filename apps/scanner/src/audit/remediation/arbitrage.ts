import { findGridEntry } from '../grid.js';
import type { AuditFacts, AxisScore, DetectedStack } from '../types.js';

/**
 * Correction-vs-redesign arbitrage + closed-CMS
 * routing.
 *
 * The audit must protect the agency from selling an untenable quick fix.
 * When the site is structurally broken - or runs on a CMS the agency cannot
 * touch - the "correction rapide" door disappears and the report pushes the
 * prospect straight to a redesign.
 *
 * Every input is a hard signal already computed elsewhere : the detected
 * CMS, the deterministic dated-tech verdict, the per-axis scores, and the
 * closed-grid "impression de modernité" cell. No new judgment is made here,
 * we only combine facts into a routing decision.
 */

export type RemediationMode = 'correction_or_redesign' | 'redesign_only';

export interface RemediationVerdict {
  mode: RemediationMode;
  /** True when the CMS is hosted/closed and not modifiable by the agency
   * (Wix, Squarespace, Framer, SimpleBO) — correction makes no sense. */
  closedCms: boolean;
  detectedStack: DetectedStack;
  /** Code's deterministic dated-tech verdict (mirrors facts.techAge). */
  datedTech: boolean;
  /** Reasons the redesign door was forced. Empty when correction stays open. */
  redesignReasons: string[];
  /**
   * Whether the UI should show the direct-pay "correction rapide" button.
   * Hidden whenever mode is redesign_only.
   */
  showQuickFixButton: boolean;
}

/** Hosted CMS the agency cannot modify : a quick correction is impossible,
 * the only real move is a WordPress rebuild. Detecting one is a commercial
 * opportunity ("tu es sur Wix, voilà ce qu'une plateforme WordPress
 * débloquerait"), not a dead end. */
const CLOSED_CMS: ReadonlySet<DetectedStack> = new Set<DetectedStack>([
  'wix',
  'squarespace',
  'framer',
  'simplebo',
]);

/** Axis scores at or below this band are "in the red". */
const RED_SCORE_THRESHOLD = 3;
/** Number of simultaneously red axes that forces a redesign. */
const RED_AXES_FOR_REDESIGN = 3;
/** UI/UX score below this means the structure itself is broken. */
const STRUCTURAL_AXIS_FLOOR = 4;

export function decideRemediation(facts: AuditFacts, scores: AxisScore[]): RemediationVerdict {
  const detectedStack = facts.stack.stack;
  const closedCms = CLOSED_CMS.has(detectedStack);
  const datedTech = facts.techAge.isDated;
  const reasons: string[] = [];

  if (closedCms) {
    reasons.push(
      `Site sur ${stackLabel(detectedStack)} (CMS fermé) : non modifiable en profondeur, une refonte WordPress est nécessaire pour débloquer SEO technique et performances.`,
    );
  }

  // Several axes collapsing at once = structural rot, not a checklist of
  // quick fixes.
  const redAxes = scores.filter((s) => s.score <= RED_SCORE_THRESHOLD);
  if (redAxes.length >= RED_AXES_FOR_REDESIGN) {
    reasons.push(
      `${String(redAxes.length)} axes dans le rouge simultanément (${redAxes
        .map((s) => s.axis)
        .join(', ')}) : le site est structurellement à reprendre.`,
    );
  }

  // A broken UI or UX axis means the foundation, not the surface, is the
  // problem.
  const uiScore = scores.find((s) => s.axis === 'ui')?.score ?? 10;
  const uxScore = scores.find((s) => s.axis === 'ux')?.score ?? 10;
  if (uiScore < STRUCTURAL_AXIS_FLOOR || uxScore < STRUCTURAL_AXIS_FLOOR) {
    reasons.push(
      `Score ${uiScore < STRUCTURAL_AXIS_FLOOR ? 'UI' : 'UX'} effondré : refonte plus rentable qu’une correction de surface.`,
    );
  }

  // Subjective "looks dated" corroborated by the measurable dated-tech
  // verdict = the strongest redesign argument (code concludes, not
  // the LLM).
  const moderniteCell = findGridEntry(facts.vision.uiGrid, 'impression_modernite');
  if (datedTech && moderniteCell?.rating === 'probleme') {
    reasons.push(
      'Stack technique datée (marqueurs mesurés) ET design perçu comme daté : refonte requise, une correction ne rajeunit pas la base.',
    );
  }

  const mode: RemediationMode = reasons.length > 0 ? 'redesign_only' : 'correction_or_redesign';

  return {
    mode,
    closedCms,
    detectedStack,
    datedTech,
    redesignReasons: reasons,
    showQuickFixButton: mode === 'correction_or_redesign',
  };
}

function stackLabel(stack: DetectedStack): string {
  const labels: Partial<Record<DetectedStack, string>> = {
    wix: 'Wix',
    squarespace: 'Squarespace',
    framer: 'Framer',
    simplebo: 'SimpleBO',
  };
  return labels[stack] ?? stack;
}
