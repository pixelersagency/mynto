import { describe, expect, it } from 'vitest';

import {
  AI_CHECK_DESCRIPTION,
  AI_CHECK_IDS,
  AI_CHECK_LABEL,
  aiRuleCode,
  aiScoredCounts,
  parseStoredAiReadiness,
} from './ai-readiness.js';
import { AuditFullResultSchema } from './audit-full.js';

describe('ai readiness schemas', () => {
  it('has 24 tests, each with a label and a description', () => {
    expect(AI_CHECK_IDS).toHaveLength(24);
    for (const id of AI_CHECK_IDS) {
      expect(AI_CHECK_LABEL[id].length).toBeGreaterThan(0);
      expect(AI_CHECK_DESCRIPTION[id].length).toBeGreaterThan(0);
    }
    expect(aiRuleCode('llms_txt')).toBe('ia.llms_txt');
  });

  it('parses a stored result and rejects garbage leniently', () => {
    const stored = {
      version: 1,
      status: 'completed',
      scanned_at: '2026-11-06T10:00:00.000Z',
      score: 60,
      level: 1,
      level_name: 'Présence de base',
      max_level: 3,
      site_type: 'vitrine',
      site_type_auto: true,
      checks: [
        {
          id: 'robots_txt',
          category: 'discoverability',
          status: 'pass',
          message: 'ok',
          weight: 3,
        },
      ],
    };
    const parsed = parseStoredAiReadiness(stored);
    expect(parsed?.checks[0]?.evidence).toEqual([]);
    expect(parsed?.included_in_global_score).toBe(false);
    expect(parseStoredAiReadiness({ version: 2 })).toBeNull();
    expect(parseStoredAiReadiness(null)).toBeNull();
    expect(aiScoredCounts(parsed?.checks ?? [])).toEqual({ passed: 1, total: 1 });
  });

  it('a malformed ai_readiness column never breaks the report read', () => {
    const base = {
      slug: 'abcdefghij12',
      url: 'https://example.com/',
      status: 'completed',
      scanned_at: null,
      stack: null,
      stack_confidence: null,
      sector: null,
      sector_confidence: null,
      main_kpi: null,
      secondary_kpi: null,
      global_score: 7,
      global_band: 'good',
      exec_summary: null,
      estimated_impact_narrative: null,
      llm_provider: null,
      llm_model: null,
      llm_duration_ms: null,
      created_at: '2026-11-06T10:00:00.000Z',
      expires_at: '2027-01-06T10:00:00.000Z',
    };
    const r = AuditFullResultSchema.parse({ ...base, ai_readiness: { nope: true }, ai_score: null });
    expect(r.ai_readiness).toBeNull();
    // Absent column (summary variant): field stays absent.
    expect(AuditFullResultSchema.parse(base).ai_readiness).toBeUndefined();
  });
});
