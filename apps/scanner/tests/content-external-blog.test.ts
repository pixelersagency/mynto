import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';

import { extractContent } from '../src/audit/collectors/content.js';

describe('extractContent — external blog detection', () => {
  it('detects a blog subdomain linked from the header', () => {
    const $ = cheerio.load(`
      <html><body>
        <header>
          <nav>
            <a href="/">Accueil</a>
            <a href="https://blog.example.com">Blog</a>
            <a href="/contact">Contact</a>
          </nav>
        </header>
        <main><p>Bienvenue sur notre site.</p></main>
      </body></html>
    `);
    const facts = extractContent($, null, 'https://example.com');
    expect(facts.hasExternalBlog).toBe(true);
    expect(facts.externalBlogUrl).toBe('https://blog.example.com/');
    expect(facts.hasBlogSection).toBe(true); // counts toward "any blog reachable"
  });

  it('detects an external personal-domain blog from anchor text (company site linking to the founder blog)', () => {
    const $ = cheerio.load(`
      <html><body>
        <header><nav>
          <a href="https://cabinet-exemple.fr/">Accueil</a>
          <a href="https://prenom-nom-exemple.fr">Mon blog</a>
        </nav></header>
        <main><p>Site corporate.</p></main>
      </body></html>
    `);
    const facts = extractContent($, null, 'https://cabinet-exemple.fr');
    expect(facts.hasExternalBlog).toBe(true);
    expect(facts.externalBlogUrl).toBe('https://prenom-nom-exemple.fr/');
  });

  it('does not flag external blog when the site already has an internal blog (anchor-text only match)', () => {
    const $ = cheerio.load(`
      <html><body>
        <header><nav>
          <a href="/blog">Notre blog</a>
          <a href="https://medium.com/@founder">Articles fondateur</a>
        </nav></header>
        <main><p>...</p></main>
      </body></html>
    `);
    const facts = extractContent($, '/blog', 'https://example.com');
    expect(facts.hasExternalBlog).toBe(false);
  });

  it('still flags a confirmed external blog subdomain even when an internal blog exists', () => {
    const $ = cheerio.load(`
      <html><body>
        <header><nav>
          <a href="/blog">Blog interne</a>
          <a href="https://blog.acme.com">Blog tech</a>
        </nav></header>
        <main><p>...</p></main>
      </body></html>
    `);
    const facts = extractContent($, '/blog', 'https://acme.com');
    expect(facts.hasExternalBlog).toBe(true);
  });

  it('does not flag external blog when no blog-like nav link exists', () => {
    const $ = cheerio.load(`
      <html><body>
        <header><nav>
          <a href="/">Accueil</a>
          <a href="/contact">Contact</a>
          <a href="https://www.linkedin.com/company/example">LinkedIn</a>
        </nav></header>
        <main><p>Pas de blog ici.</p></main>
      </body></html>
    `);
    const facts = extractContent($, null, 'https://example.com');
    expect(facts.hasExternalBlog).toBe(false);
    expect(facts.hasBlogSection).toBe(false);
  });

  it('treats www and bare host as the same origin', () => {
    const $ = cheerio.load(`
      <html><body>
        <header><nav>
          <a href="https://www.example.com/blog">Blog</a>
        </nav></header>
        <main><p>...</p></main>
      </body></html>
    `);
    const facts = extractContent($, null, 'https://example.com');
    // /blog is on the same registrable domain → not external.
    expect(facts.hasExternalBlog).toBe(false);
  });
});
