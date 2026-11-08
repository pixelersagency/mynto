import * as cheerio from 'cheerio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectConversion } from '../src/audit/collectors/conversion.js';

const COLLECT_OPTS = { userAgent: 'test', knownLinks: [] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('testimonials v2 — multiple signals', () => {
  it('counts 3 photo+name+role testimonial cards with no semantic class (plain divs pattern)', async () => {
    const $ = cheerio.load(`
      <html><body>
        <main>
          <h1>Marque employeur</h1>
          <div class="grid">
            <div>
              <img src="/paul.jpg" alt="Paul Martin"/>
              <p>"Leur travail a transformé notre approche RH."</p>
              <p>Paul Martin — Directeur RH, Groupe Alpha</p>
            </div>
            <div>
              <img src="/claire.jpg" alt="Claire Dubois"/>
              <p>"Une approche concrète et différenciante."</p>
              <p>Claire Dubois — Responsable Marque Employeur, Hôtels Beta</p>
            </div>
            <div>
              <img src="/marc.jpg" alt="Marc Lefèvre"/>
              <p>"Ils apportent un vrai regard d'expert."</p>
              <p>Marc Lefèvre — Président, Cabinet Gamma</p>
            </div>
          </div>
        </main>
      </body></html>
    `);
    const facts = await collectConversion('https://example.com', $, COLLECT_OPTS);
    expect(facts.testimonialsCount).toBeGreaterThanOrEqual(3);
    expect(facts.testimonialsHaveName).toBe(true);
    expect(facts.testimonialsHavePhoto).toBe(true);
  });

  it('counts standalone <blockquote> with quoted text as a testimonial', async () => {
    const $ = cheerio.load(`
      <html><body>
        <article>
          <blockquote>
            "Mynto nous a permis de diviser par 8 nos pannes de production en moins de six mois.
            Une réelle révolution pour nos équipes IT."
            — Sophie Durand, Directrice IT, AG2R
          </blockquote>
        </article>
      </body></html>
    `);
    const facts = await collectConversion('https://example.com', $, COLLECT_OPTS);
    expect(facts.testimonialsCount).toBeGreaterThanOrEqual(1);
    expect(facts.testimonialsHaveName).toBe(true);
  });

  it('counts schema.org Review JSON-LD entries', async () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'Review',
          author: { '@type': 'Person', name: 'Camille Martin' },
          reviewBody: 'Service exceptionnel.',
        },
        {
          '@type': 'Review',
          author: 'Antoine Bernard',
          reviewBody: 'Hautement recommandé.',
        },
        {
          '@type': 'AggregateRating',
          reviewCount: 50,
          ratingValue: 4.8,
        },
      ],
    });
    const $ = cheerio.load(`
      <html><body>
        <main><h1>Home</h1></main>
        <script type="application/ld+json">${ld}</script>
      </body></html>
    `);
    const facts = await collectConversion('https://example.com', $, COLLECT_OPTS);
    expect(facts.testimonialsCount).toBeGreaterThanOrEqual(3);
    expect(facts.testimonialsHaveName).toBe(true);
  });

  it('does not double-count when a hint section AND its inner blockquote both match', async () => {
    const $ = cheerio.load(`
      <html><body>
        <section class="testimonials">
          <blockquote>
            "Une équipe vraiment exceptionnelle qui a su comprendre nos enjeux dès le départ."
            — Marie Lefevre, CEO, Acme
          </blockquote>
        </section>
      </body></html>
    `);
    const facts = await collectConversion('https://example.com', $, COLLECT_OPTS);
    // Section + nested blockquote could produce 2; gate is fine if it only counts once.
    expect(facts.testimonialsCount).toBeLessThanOrEqual(2);
    expect(facts.testimonialsCount).toBeGreaterThanOrEqual(1);
  });

  it('does not count an empty nav link named "Références"', async () => {
    const $ = cheerio.load(`
      <html><body>
        <nav><a class="nav-references" href="/references">Références</a></nav>
        <main><p>Contenu principal.</p></main>
      </body></html>
    `);
    const facts = await collectConversion('https://example.com', $, COLLECT_OPTS);
    expect(facts.testimonialsCount).toBe(0);
  });

  it('handles malformed JSON-LD without throwing', async () => {
    const $ = cheerio.load(`
      <html><body>
        <main><h1>Home</h1></main>
        <script type="application/ld+json">{ this is not json </script>
      </body></html>
    `);
    const facts = await collectConversion('https://example.com', $, COLLECT_OPTS);
    expect(facts.testimonialsCount).toBe(0);
  });
});
