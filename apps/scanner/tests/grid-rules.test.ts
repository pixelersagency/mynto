import { describe, expect, it } from 'vitest';

import { applyGridRules } from '../src/audit/rules/grid-rules.js';
import type { AuditFacts } from '../src/audit/types.js';

import { makeBaseFacts } from './helpers/base-facts.js';

function ctx(facts: AuditFacts) {
  return { facts, origin: 'https://example.com' };
}

describe('grid rules (closed UI/UX rubric)', () => {
  it('emits nothing when vision did not run', () => {
    const facts = makeBaseFacts(); // vision.fetched = false
    expect(applyGridRules(ctx(facts))).toHaveLength(0);
  });

  it('droit au neutre: bon and neutre never fire a finding', () => {
    const facts = makeBaseFacts({
      vision: {
        ...makeBaseFacts().vision,
        fetched: true,
        uiGrid: [
          { key: 'hierarchie_visuelle', rating: 'bon', justification: 'progression nette' },
          { key: 'impression_modernite', rating: 'neutre', justification: 'sobre mais propre' },
          { key: 'coherence_couleurs', rating: 'neutre', justification: 'palette ok' },
        ],
      },
    });
    expect(applyGridRules(ctx(facts))).toHaveLength(0);
  });

  it('fires a qualitative finding only on probleme, carrying the justification', () => {
    const facts = makeBaseFacts({
      vision: {
        ...makeBaseFacts().vision,
        fetched: true,
        model: 'gemini-2.5-flash',
        uiGrid: [
          {
            key: 'traitement_cta',
            rating: 'probleme',
            justification: 'CTA gris sur fond gris',
            viewport: 'mobile',
            region: 'hero',
          },
          { key: 'densite_espacement', rating: 'bon', justification: 'respiration correcte' },
        ],
      },
    });
    const findings = applyGridRules(ctx(facts));
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f?.ruleCode).toBe('ui.cta.weak');
    expect(f?.kind).toBe('qualitative');
    expect(f?.evidence.justification).toBe('CTA gris sur fond gris');
  });

  it('does NOT fire a probleme with an empty justification (justification obligatoire)', () => {
    const facts = makeBaseFacts({
      vision: {
        ...makeBaseFacts().vision,
        fetched: true,
        uiGrid: [
          { key: 'qualite_images', rating: 'probleme', justification: '   ' },
          { key: 'coherence_typographique', rating: 'probleme', justification: '' },
        ],
      },
    });
    expect(applyGridRules(ctx(facts))).toHaveLength(0);
  });

  it('requires screenshot location even for a nonempty justification', () => {
    const facts = makeBaseFacts();
    facts.vision.fetched = true;
    facts.vision.uiGrid = [
      { key: 'traitement_cta', rating: 'probleme', justification: 'unverified claim' },
    ];
    expect(applyGridRules(ctx(facts))).toHaveLength(0);
  });

  it('routes navigation_clarte to the ux axis', () => {
    const facts = makeBaseFacts({
      vision: {
        ...makeBaseFacts().vision,
        fetched: true,
        uiGrid: [
          {
            key: 'navigation_clarte',
            rating: 'probleme',
            justification: 'labels opaques',
            viewport: 'desktop',
            region: 'navigation supérieure',
          },
        ],
      },
    });
    const findings = applyGridRules(ctx(facts));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.axis).toBe('ux');
    expect(findings[0]?.ruleCode).toBe('ux.navigation.unclear');
  });

  it('never treats apparent modernity or legacy technology as a visual usability failure', () => {
    const facts = makeBaseFacts({
      techAge: { ...makeBaseFacts().techAge, isDated: true, reasons: ['Bootstrap 3'] },
      vision: {
        ...makeBaseFacts().vision,
        fetched: true,
        uiGrid: [
          { key: 'impression_modernite', rating: 'probleme', justification: 'effets années 2010' },
        ],
      },
    });
    const findings = applyGridRules(ctx(facts));
    const f = findings.find((x) => x.ruleCode === 'ui.design.dated_for_sector');
    expect(f).toBeUndefined();
  });
});
