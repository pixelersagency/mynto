import { describe, expect, it } from 'vitest';

import { detectTechAge } from '../src/audit/collectors/tech-age.js';

describe('detectTechAge', () => {
  it('flags old jQuery 1.x as dated', () => {
    const r = detectTechAge({
      rawHtml: '<script src="/js/jquery-1.12.4.min.js"></script>',
      hasMobileViewport: true,
    });
    expect(r.jqueryVersion).toBe('1.12');
    expect(r.jqueryMajor).toBe(1);
    expect(r.isDated).toBe(true);
  });

  it('does NOT flag modern jQuery 3.x by itself', () => {
    const r = detectTechAge({
      rawHtml: '<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>',
      hasMobileViewport: true,
    });
    expect(r.jqueryMajor).toBe(3);
    expect(r.isDated).toBe(false);
  });

  it('flags Bootstrap 3 as dated', () => {
    const r = detectTechAge({
      rawHtml: '<link href="/vendor/bootstrap-3.3.7/css/bootstrap.min.css" rel="stylesheet">',
      hasMobileViewport: true,
    });
    expect(r.bootstrapMajor).toBe(3);
    expect(r.isDated).toBe(true);
  });

  it('does NOT mis-read react-bootstrap as Bootstrap core 1.x', () => {
    const r = detectTechAge({
      rawHtml: '<script src="/node_modules/react-bootstrap-1.6.4/dist/index.js"></script>',
      hasMobileViewport: true,
    });
    expect(r.bootstrapMajor).toBeNull();
    expect(r.isDated).toBe(false);
  });

  it('does NOT flag a data table without <th> when no layout attrs are present', () => {
    const r = detectTechAge({
      rawHtml: '<table class="prix"><tr><td>Offre</td><td>Prix</td></tr></table>',
      hasMobileViewport: true,
    });
    expect(r.layoutTablesDetected).toBe(false);
    expect(r.isDated).toBe(false);
  });

  it('flags a table with presentational layout attributes', () => {
    const r = detectTechAge({
      rawHtml: '<table cellpadding="0" cellspacing="0" border="0"><tr><td>menu</td></tr></table>',
      hasMobileViewport: true,
    });
    expect(r.layoutTablesDetected).toBe(true);
    expect(r.isDated).toBe(true);
  });

  it('flags deprecated presentational tags', () => {
    const r = detectTechAge({
      rawHtml: '<center><font size="3">Bienvenue</font></center>',
      hasMobileViewport: true,
    });
    expect(r.deprecatedTags).toContain('center');
    expect(r.deprecatedTags).toContain('font');
    expect(r.isDated).toBe(true);
  });

  it('flags nested layout tables but not data tables with <th>', () => {
    const layout = detectTechAge({
      rawHtml: '<table><tr><td><table><tr><td>menu</td></tr></table></td></tr></table>',
      hasMobileViewport: true,
    });
    expect(layout.layoutTablesDetected).toBe(true);
    expect(layout.isDated).toBe(true);

    const data = detectTechAge({
      rawHtml: '<table border="1"><tr><th>Nom</th></tr><tr><td>Jean</td></tr></table>',
      hasMobileViewport: true,
    });
    expect(data.layoutTablesDetected).toBe(false);
  });

  it('flags legacy doctype', () => {
    const r = detectTechAge({
      rawHtml:
        '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd"><html></html>',
      hasMobileViewport: true,
    });
    expect(r.legacyDoctype).toBe(true);
    expect(r.isDated).toBe(true);
  });

  it('flags Flash embeds', () => {
    const r = detectTechAge({
      rawHtml: '<embed src="intro.swf" type="application/x-shockwave-flash">',
      hasMobileViewport: true,
    });
    expect(r.flashEmbedDetected).toBe(true);
    expect(r.isDated).toBe(true);
  });

  it('does NOT flag a clean modern HTML5 page', () => {
    const r = detectTechAge({
      rawHtml:
        '<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width"></head><body><main><h1>Hi</h1></main></body></html>',
      hasMobileViewport: true,
    });
    expect(r.isDated).toBe(false);
    expect(r.reasons).toHaveLength(0);
  });

  it('missing viewport alone does not flip the verdict', () => {
    const r = detectTechAge({
      rawHtml: '<!doctype html><html><body><main>modern but no viewport</main></body></html>',
      hasMobileViewport: false,
    });
    expect(r.noResponsiveViewport).toBe(true);
    expect(r.isDated).toBe(false);
  });
});
