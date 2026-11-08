import { buildAxis, fail, info, pass, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

/**
 * Local performance heuristics. Real Core Web Vitals (LCP/CLS/INP) need
 * Lighthouse — surfaced via the full audit. These are the structural
 * smells a content script can read instantly.
 */
export function evaluatePerformance(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // DOM size
  if (f.domNodeCount > 3000) {
    c.push(
      fail(
        'perf.dom.huge',
        'Taille du DOM',
        `DOM très lourd (${String(f.domNodeCount)} éléments).`,
        f.domNodeCount,
      ),
    );
  } else if (f.domNodeCount > 1500) {
    c.push(
      warn(
        'perf.dom.large',
        'Taille du DOM',
        `DOM volumineux (${String(f.domNodeCount)} éléments).`,
        f.domNodeCount,
      ),
    );
  } else {
    c.push(
      pass('perf.dom.ok', 'Taille du DOM', `${String(f.domNodeCount)} éléments.`, f.domNodeCount),
    );
  }

  // Scripts
  if (f.scriptCount > 30) {
    c.push(
      fail(
        'perf.scripts.many',
        'Scripts externes',
        `${String(f.scriptCount)} scripts chargés (blocage JS probable).`,
        f.scriptCount,
      ),
    );
  } else if (f.scriptCount > 15) {
    c.push(
      warn(
        'perf.scripts.some',
        'Scripts externes',
        `${String(f.scriptCount)} scripts chargés.`,
        f.scriptCount,
      ),
    );
  } else {
    c.push(
      pass(
        'perf.scripts.ok',
        'Scripts externes',
        `${String(f.scriptCount)} scripts.`,
        f.scriptCount,
      ),
    );
  }

  // Render-blocking CSS
  if (f.renderBlockingStyles > 4) {
    c.push(
      warn(
        'perf.css.blocking',
        'CSS bloquant',
        `${String(f.renderBlockingStyles)} feuilles de style bloquent le rendu.`,
        f.renderBlockingStyles,
      ),
    );
  } else {
    c.push(
      pass(
        'perf.css.ok',
        'CSS bloquant',
        `${String(f.renderBlockingStyles)} feuille(s) bloquante(s).`,
        f.renderBlockingStyles,
      ),
    );
  }

  // Lazy loading
  if (f.imagesTotal > 0) {
    const lazyRatio = f.imagesLazy / f.imagesTotal;
    if (lazyRatio < 0.4 && f.imagesTotal >= 5) {
      c.push(
        warn(
          'perf.images.lazy',
          'Lazy-loading images',
          `Seules ${String(Math.round(lazyRatio * 100))}% des images sont en lazy-load.`,
          `${String(f.imagesLazy)}/${String(f.imagesTotal)}`,
        ),
      );
    } else {
      c.push(
        pass(
          'perf.images.lazy',
          'Lazy-loading images',
          `${String(f.imagesLazy)}/${String(f.imagesTotal)} images en lazy-load.`,
        ),
      );
    }

    // Dimensions (CLS)
    const dimRatio = f.imagesWithDimensions / f.imagesTotal;
    if (dimRatio < 0.7) {
      c.push(
        warn(
          'perf.images.dimensions',
          'Dimensions images',
          'Images sans width/height : risque de décalage visuel (CLS).',
          `${String(f.imagesWithDimensions)}/${String(f.imagesTotal)}`,
        ),
      );
    } else {
      c.push(
        pass(
          'perf.images.dimensions',
          'Dimensions images',
          'La plupart des images ont des dimensions fixées.',
        ),
      );
    }

    // Oversized
    if (f.imagesOversized > 0) {
      c.push(
        warn(
          'perf.images.oversized',
          'Images surdimensionnées',
          `${String(f.imagesOversized)} image(s) affichée(s) bien plus petites que leur taille réelle.`,
          f.imagesOversized,
        ),
      );
    }
  }

  // Inline style weight
  if (f.inlineStyleBytes > 50_000) {
    c.push(
      warn(
        'perf.inline_styles',
        'Styles inline',
        `${String(Math.round(f.inlineStyleBytes / 1024))} Ko de styles inline.`,
        f.inlineStyleBytes,
      ),
    );
  }

  c.push(
    info(
      'perf.note',
      'Core Web Vitals',
      'LCP, CLS et INP réels sont mesurés dans le rapport complet.',
    ),
  );

  return buildAxis('performance', c);
}
