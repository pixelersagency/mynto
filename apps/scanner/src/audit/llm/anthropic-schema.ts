import { RESPONSE_JSON_SCHEMA } from './prompts.js';

/**
 * Claude structured outputs (`output_config.format`) guarantee the shape of
 * the audit narrative (required fields, enums, no stray nulls) but ignore
 * length and count constraints. Those still matter: LlmAuditOutputSchema
 * (Zod) rejects a 90-char `sector.detected`. So the limits are written into
 * each field's description, and `clampToLimits` trims whatever still
 * overflows before Zod runs.
 *
 * Paths: `a.b` for object properties, `a[]` for array items. Values mirror
 * the `.max()` bounds in output-schema.ts; keep both in sync.
 */
export const TEXT_LIMITS: Record<string, number> = {
  'sector.detected': 80,
  'sector.mainKpi': 120,
  'sector.secondaryKpi': 120,
  'sector.audienceNotes': 500,
  execSummary: 3000,
  estimatedImpactNarrative: 2000,
  'quickWins[]': 400,
  'killerFindings[]': 80,
  'top3Priorities[].title': 160,
  'top3Priorities[].reason': 2000,
  'top3Priorities[].expectedOutcome': 1500,
  'findings[].title': 200,
  'findings[].constat': 1500,
  'findings[].impactBusiness': 2000,
  'findings[].recommandation': 1500,
  'findings[].codeSnippet': 2500,
};

const ARRAY_LIMITS: Record<string, { max: number; hint: string }> = {
  top3Priorities: { max: 3, hint: 'Exactement 3 éléments.' },
  quickWins: { max: 10, hint: '10 éléments au plus.' },
  killerFindings: { max: 5, hint: '5 éléments au plus.' },
};

/** Keywords Claude structured outputs do not support (see API docs). */
const UNSUPPORTED = new Set([
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'nullable',
]);

type JsonSchema = Record<string, unknown>;

function convert(node: JsonSchema, path: string): JsonSchema {
  const out: JsonSchema = {};
  for (const [k, v] of Object.entries(node)) {
    if (!UNSUPPORTED.has(k)) out[k] = v;
  }
  if (node.type === 'object' && node.properties) {
    const props: Record<string, JsonSchema> = {};
    for (const [name, child] of Object.entries(node.properties as Record<string, JsonSchema>)) {
      props[name] = convert(child, path ? `${path}.${name}` : name);
    }
    out.properties = props;
    out.additionalProperties = false;
  }
  if (node.type === 'array' && node.items) {
    out.items = convert(node.items as JsonSchema, `${path}[]`);
    const arr = ARRAY_LIMITS[path];
    if (arr) out.description = arr.hint;
  }
  const max = TEXT_LIMITS[path];
  if (node.type === 'string' && max) out.description = `${String(max)} caractères au plus.`;
  return out;
}

/** RESPONSE_JSON_SCHEMA (Gemini flavour) rewritten for Claude structured outputs. */
export const ANTHROPIC_RESPONSE_SCHEMA: JsonSchema = convert(
  RESPONSE_JSON_SCHEMA as JsonSchema,
  '',
);

function cut(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function clamp(value: unknown, path: string): unknown {
  if (typeof value === 'string') {
    const max = TEXT_LIMITS[path];
    return max ? cut(value, max) : value;
  }
  if (Array.isArray(value)) {
    const arr = ARRAY_LIMITS[path];
    const items = arr ? value.slice(0, arr.max) : value;
    return items.map((v) => clamp(v, `${path}[]`));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null) continue; // optional fields come back absent, never null
      out[k] = clamp(v, path ? `${path}.${k}` : k);
    }
    return out;
  }
  return value;
}

/** Trims over-long texts and over-long lists so Zod length bounds hold. */
export function clampToLimits(value: unknown): unknown {
  return clamp(value, '');
}
