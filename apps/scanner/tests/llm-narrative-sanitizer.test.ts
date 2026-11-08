import { describe, expect, it } from 'vitest';

import { sanitizeAuditNarrative } from '../src/audit/llm/client.js';
import { LlmAuditOutputSchema, type LlmAuditOutput } from '../src/audit/llm/output-schema.js';

const id = 'seo.sitemap.missing:abc';
function fixture(): LlmAuditOutput {
  return {
    sector: {
      detected: 'Agence',
      confidence: 1,
      mainKpi: 'Devis',
      secondaryKpi: 'Contacts',
      audienceNotes: 'Les findings',
    },
    execSummary: 'Les findings (seo.sitemap.missing) montrent un sitemap absent.',
    globalBand: 'fair',
    top3Priorities: [
      {
        title: 'Corriger les findings',
        reason: `Deux findings (${id}) convergent.`,
        findingIds: [id],
        findingId: id,
        expectedOutcome: 'Un finding corrigé',
      },
    ],
    quickWins: ['Corriger le finding seo.sitemap.missing.'],
    killerFindings: [id],
    estimatedImpactNarrative: 'Ces findings limitent les demandes de devis.',
    findings: [
      {
        findingId: id,
        title: 'Un finding à corriger',
        constat: 'Le sitemap manque (seo.sitemap.missing).',
        impactBusiness: 'Les findings limitent les visites.',
        recommandation: 'Corriger ce finding.',
        codeSnippet: 'const findings = "seo.sitemap.missing";  // keep spacing',
        severity: 'P1',
        effort: 'quick_win',
      },
    ],
  };
}

describe('sanitizeAuditNarrative', () => {
  it('cleans every narrative group and removes known rule codes and full IDs', () => {
    const result = sanitizeAuditNarrative(fixture(), new Set([id]));
    expect(result.execSummary).toBe('Les constats montrent un sitemap absent.');
    expect(result.top3Priorities[0]?.reason).toBe('Deux constats convergent.');
    expect(result.quickWins).toEqual(['Corriger le constat.']);
    expect(result.killerFindings).toEqual([id]);
    expect(result.sector.audienceNotes).toBe('Les constats');
    expect(result.findings[0]?.recommandation).toBe('Corriger ce constat.');
    expect(result.top3Priorities[0]?.expectedOutcome).toBe('Un constat corrigé');
  });

  it('preserves structured IDs, enums, code and the input object', () => {
    const input = fixture();
    const result = sanitizeAuditNarrative(input, new Set([id]));
    expect(result.findings[0]?.findingId).toBe(id);
    expect(result.top3Priorities[0]?.findingIds).toEqual([id]);
    expect(result.top3Priorities[0]?.findingId).toBe(id);
    expect(result.findings[0]?.codeSnippet).toBe(input.findings[0]?.codeSnippet);
    expect(result.globalBand).toBe(input.globalBand);
    expect(result.killerFindings).toEqual(input.killerFindings);
    expect(input.execSummary).toContain('findings');
  });

  it('preserves code spans, fenced code, public standards and URLs', () => {
    const input = fixture();
    const code = '`const findings =  2`';
    const fence = '```js\n  const findings = "seo.sitemap.missing";\n```';
    input.execSummary = `WCAG 1.4.4, RGAA 10.4, https://example.com/seo.sitemap.missing ${code} ${fence}`;
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(input.execSummary);
  });

  it('removes an isolated backticked rule ID but keeps unrelated words', () => {
    const input = fixture();
    input.execSummary =
      'Corriger `seo.sitemap.missing`, puis vérifier findingsCount et sitemap.xml.';
    const result = sanitizeAuditNarrative(input, new Set([id]));
    expect(result.execSummary).not.toContain('seo.sitemap.missing');
    expect(result.execSummary).toContain('findingsCount et sitemap.xml');
  });

  it('works with no known IDs and is idempotent', () => {
    const result = sanitizeAuditNarrative(fixture(), new Set());
    expect(result.execSummary).toContain('constats');
    expect(sanitizeAuditNarrative(result, new Set())).toEqual(result);
  });
  it('removes leftover separators around plain and backticked internal IDs', () => {
    const input = fixture();
    input.execSummary = 'À corriger (seo.sitemap.missing, P1) et (`seo.sitemap.missing`, P1).';
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(
      'À corriger (P1) et (P1).',
    );
  });

  it('preserves sector classification and KPI text even when equal to an internal token', () => {
    const input = fixture();
    input.sector.detected = id;
    input.sector.mainKpi = id;
    input.sector.secondaryKpi = id;
    const result = sanitizeAuditNarrative(input, new Set([id]));
    expect(result.sector.detected).toBe(id);
    expect(result.sector.mainKpi).toBe(id);
    expect(result.sector.secondaryKpi).toBe(id);
    expect(result.sector.confidence).toBe(input.sector.confidence);
  });

  it('keeps valid output valid, and exposes prose emptied by cleaning to schema rejection', () => {
    const input = fixture();
    input.execSummary =
      'Les findings limitent les demandes de devis sur ce site de boulangerie et empêchent les visiteurs de passer commande.';
    const priority = input.top3Priorities[0];
    const finding = input.findings[0];
    if (!priority || !finding) throw new Error('Missing test fixture');
    input.top3Priorities = Array.from({ length: 3 }, () => ({
      ...priority,
      reason: 'Deux findings convergent et limitent les commandes.',
    }));
    finding.constat = 'Le sitemap manque dans la configuration du site (seo.sitemap.missing).';
    finding.recommandation = 'Corriger ce finding dans la configuration du site.';
    expect(LlmAuditOutputSchema.safeParse(input).success).toBe(true);
    expect(
      LlmAuditOutputSchema.safeParse(sanitizeAuditNarrative(input, new Set([id]))).success,
    ).toBe(true);
    input.quickWins = [id];
    expect(LlmAuditOutputSchema.safeParse(input).success).toBe(true);
    expect(
      LlmAuditOutputSchema.safeParse(sanitizeAuditNarrative(input, new Set([id]))).success,
    ).toBe(false);
  });
  it('preserves URL tokens and Markdown targets while translating their prose labels', () => {
    const input = fixture();
    input.execSummary =
      'Les findings : https://example.com/findings?q=finding#findings et [findings](https://example.com/findings), [finding](/findings) et <https://example.com/finding>.';
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(
      'Les constats: https://example.com/findings?q=finding#findings et [constats](https://example.com/findings), [constat](/findings) et <https://example.com/finding>.',
    );
  });

  it.each([
    '~~~js\nconst value = `seo.sitemap.missing`;\n~~~\n',
    '    const value = `seo.sitemap.missing`;\n',
    '~~~js\n  const findings = "seo.sitemap.missing";\n~~~\n',
    '````js\nconst findings = `finding`;\n```\n````\n',
    '~~~~js\nconst findings =  2;\n~~~\n~~~~~\n',
    '``const findings = `finding`;  ``',
    '`findings.replace(/x/g, "$&")`',
    '```const findings = ``finding``;```',
    '    const findings =  "seo.sitemap.missing";\n    findings++;\n',
    '\tconst findings =  2;\n',
  ])('preserves code bytes for %j', (code) => {
    const input = fixture();
    input.execSummary = `Les findings :\n${code}\nAutre finding.`;
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(
      `Les constats:\n${code}\nAutre constat.`,
    );
  });

  it('preserves code indentation and trailing newlines at narrative boundaries', () => {
    const input = fixture();
    input.execSummary = '    const findings =  2;\n';
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(input.execSummary);
  });

  it('still removes an exact internal ID quoted alone with variable backticks', () => {
    const input = fixture();
    input.execSummary = 'Corriger (``seo.sitemap.missing``, P1), puis le finding.';
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(
      'Corriger (P1), puis le constat.',
    );
  });
  it('preserves an unclosed fence through the end of the narrative', () => {
    const input = fixture();
    input.execSummary = 'Les findings\n~~~js\nconst findings =  2;\n';
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(
      'Les constats\n~~~js\nconst findings =  2;\n',
    );
  });

  it('preserves Markdown targets with a title and protected URL tokens', () => {
    const input = fixture();
    input.execSummary = '[findings](https://example.com/findings "finding details")';
    expect(sanitizeAuditNarrative(input, new Set([id])).execSummary).toBe(
      '[constats](https://example.com/findings "finding details")',
    );
  });
});
