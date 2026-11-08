import { describe, expect, it } from 'vitest';

import { ANTHROPIC_RESPONSE_SCHEMA, clampToLimits } from '../src/audit/llm/anthropic-schema.js';
import { supportsStructuredOutput } from '../src/audit/llm/client.js';

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  visit(n);
  for (const v of Object.values(n)) walk(v, visit);
}

describe('ANTHROPIC_RESPONSE_SCHEMA', () => {
  it('drops keywords Claude structured outputs reject and closes every object', () => {
    walk(ANTHROPIC_RESPONSE_SCHEMA, (n) => {
      for (const k of [
        'minimum',
        'maximum',
        'minLength',
        'maxLength',
        'minItems',
        'maxItems',
        'nullable',
      ]) {
        expect(n).not.toHaveProperty(k);
      }
      if (n.type === 'object') expect(n.additionalProperties).toBe(false);
    });
  });
  it('writes the length limits into field descriptions', () => {
    const sector = (
      ANTHROPIC_RESPONSE_SCHEMA.properties as Record<
        string,
        { properties: Record<string, { description?: string }> }
      >
    ).sector;
    expect(sector?.properties.detected?.description).toMatch(/80/);
  });
});

describe('clampToLimits', () => {
  it('trims over-long texts and lists and drops nulls', () => {
    const out = clampToLimits({
      sector: { detected: 'x'.repeat(120), mainKpi: 'kpi' },
      killerFindings: ['a', 'b', 'c', 'd', 'e', 'f'],
      findings: [{ title: 'Titre', codeSnippet: null }],
    }) as {
      sector: { detected: string };
      killerFindings: string[];
      findings: Record<string, unknown>[];
    };
    expect(out.sector.detected.length).toBe(80);
    expect(out.sector.detected.endsWith('…')).toBe(true);
    expect(out.killerFindings).toHaveLength(5);
    expect(out.findings[0]).not.toHaveProperty('codeSnippet');
  });
});

describe('supportsStructuredOutput', () => {
  it('is on for the 5 family, Opus 4.8 and Haiku 4.5 only', () => {
    expect(supportsStructuredOutput('claude-haiku-5-5')).toBe(true);
    expect(supportsStructuredOutput('claude-opus-4-8')).toBe(true);
    expect(supportsStructuredOutput('claude-sonnet-4-6')).toBe(false);
  });
});
