import { AI_LEVELS, type AiCheckId, type AiCheckResult } from '@mynto/shared';

/**
 * Score = weighted share of the checks that actually applied.
 *
 * `neutral` and `skipped` checks leave the denominator, so a brochure
 * site is not punished for having no checkout protocol and a DNS probe
 * that could not run never costs points.
 */
export function computeScore(checks: AiCheckResult[]): number {
  let earned = 0;
  let applicable = 0;
  for (const check of checks) {
    if (check.weight <= 0) continue;
    if (check.status !== 'pass' && check.status !== 'fail') continue;
    applicable += check.weight;
    if (check.status === 'pass') earned += check.weight;
  }
  if (applicable === 0) return 0;
  return Math.round((earned / applicable) * 100);
}

/** Requirements of each level, expressed over check ids. */
const LEVEL_REQUIREMENTS: { level: number; all?: AiCheckId[]; anyOf?: AiCheckId[][] }[] = [
  { level: 1, all: ['robots_txt', 'sitemap'] },
  { level: 2, all: ['ai_bot_rules', 'content_signals'] },
  {
    level: 3,
    all: ['no_js_content', 'ai_bot_live_access'],
    anyOf: [['markdown_negotiation', 'llms_txt']],
  },
  {
    level: 4,
    anyOf: [['mcp_server_card', 'a2a_agent_card', 'agent_skills', 'api_catalog', 'webmcp']],
  },
  { level: 5, anyOf: [['x402', 'mpp', 'ucp', 'acp']] },
];

export interface LevelOutcome {
  level: number;
  levelName: string;
  /** Checks blocking the next level, in report order. Empty at level 5. */
  blocking: AiCheckId[];
}

/**
 * @param maxLevel Ceiling for this site type. A brochure site tops out at
 * level 3: there is nothing above it that it should be exposing.
 */
export function computeLevel(checks: AiCheckResult[], maxLevel = 5): LevelOutcome {
  const byId = new Map(checks.map((c) => [c.id, c] as const));
  const passes = (id: AiCheckId): boolean => byId.get(id)?.status === 'pass';

  let level = 0;
  for (const req of LEVEL_REQUIREMENTS) {
    if (req.level > maxLevel) break;
    if (!levelSatisfied(req, passes)) break;
    level = req.level;
  }

  const next =
    level >= maxLevel ? undefined : LEVEL_REQUIREMENTS.find((r) => r.level === level + 1);
  const blocking = next === undefined ? [] : missingFor(next, passes);

  return {
    level,
    levelName: AI_LEVELS[level]?.name ?? 'Invisible',
    blocking,
  };
}

function levelSatisfied(
  req: { all?: AiCheckId[]; anyOf?: AiCheckId[][] },
  passes: (id: AiCheckId) => boolean,
): boolean {
  const allOk = (req.all ?? []).every(passes);
  const anyOk = (req.anyOf ?? []).every((group) => group.some(passes));
  return allOk && anyOk;
}

function missingFor(
  req: { all?: AiCheckId[]; anyOf?: AiCheckId[][] },
  passes: (id: AiCheckId) => boolean,
): AiCheckId[] {
  const missing: AiCheckId[] = (req.all ?? []).filter((id) => !passes(id));
  for (const group of req.anyOf ?? []) {
    if (group.some(passes)) continue;
    const first = group[0];
    if (first !== undefined) missing.push(first);
  }
  return missing;
}

export const __testables = { LEVEL_REQUIREMENTS };
