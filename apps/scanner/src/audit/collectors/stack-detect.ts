import type { DetectedStack, StackSignal } from '../types.js';

interface StackSignature {
  stack: DetectedStack;
  htmlPatterns?: RegExp[];
  headerPatterns?: { name: string; value: RegExp }[];
  cookiePatterns?: RegExp[];
  generatorPatterns?: RegExp[];
  scriptPathPatterns?: RegExp[];
  weight: number;
}

const SIGNATURES: StackSignature[] = [
  {
    stack: 'wordpress',
    htmlPatterns: [
      /\/wp-content\//i,
      /\/wp-includes\//i,
      /\bwp-json\b/i,
      /\bwp-emoji\b/i,
      /<meta name=["']generator["'][^>]*WordPress/i,
    ],
    generatorPatterns: [/WordPress/i],
    weight: 1,
  },
  {
    stack: 'shopify',
    htmlPatterns: [
      /cdn\.shopify\.com/i,
      /\bShopify\.theme\b/,
      /\.myshopify\.com/i,
      /Shopify\.designMode/,
    ],
    headerPatterns: [
      { name: 'x-shopify-stage', value: /./ },
      { name: 'x-shopify-shop-id', value: /./ },
      { name: 'powered-by', value: /Shopify/i },
    ],
    weight: 1,
  },
  {
    stack: 'wix',
    htmlPatterns: [/wixstatic\.com/i, /wix-warmup-data/i, /static\.parastorage\.com/i],
    weight: 1,
  },
  {
    stack: 'webflow',
    htmlPatterns: [
      /webflow\.com/i,
      /data-wf-page=/i,
      /\bwebflow\.js\b/i,
      /assets\.website-files\.com/i,
    ],
    generatorPatterns: [/Webflow/i],
    weight: 1,
  },
  {
    stack: 'framer',
    htmlPatterns: [
      /framerusercontent\.com/i,
      /\bdata-framer-\b/,
      /<meta name=["']framer-search-index["']/i,
    ],
    generatorPatterns: [/Framer/i],
    weight: 1,
  },
  {
    stack: 'squarespace',
    htmlPatterns: [/static1\.squarespace\.com/i, /\bSquarespace\.\w+/, /squarespace-cdn\.com/i],
    headerPatterns: [{ name: 'x-served-by', value: /Squarespace/i }],
    weight: 1,
  },
  {
    // SimpleBO : CMS / page builder grand public francais (PME, TPE,
    // independants, conferenciers). Hosted SaaS, theme + bloc system.
    // Signature stable : domaines simplebo.net (admin / app) et
    // sbcdnsb.com (CDN assets, JS/CSS/img). Optional generator meta
    // "SimpleBO" sometimes present.
    stack: 'simplebo',
    htmlPatterns: [/simplebo\.net/i, /sbcdnsb\.com/i, /\bsb-(?:bloc|page|module)\b/i],
    generatorPatterns: [/SimpleBO/i],
    weight: 1.2, // Higher than generic to win against react_generic noise.
  },
  {
    // Bricks Builder for WordPress. Detection: prefixed CSS classes
    // (brxe-*) injected on every Bricks-rendered element + the global
    // /wp-content/plugins/bricks asset path.
    stack: 'wordpress_bricks',
    htmlPatterns: [
      /class=["'][^"']*\bbrxe-/i,
      /\/wp-content\/plugins\/bricks\//i,
      /<meta name=["']generator["'][^>]*Bricks/i,
    ],
    generatorPatterns: [/Bricks/i],
    // Higher than plain WordPress so a WP+Bricks site wins the WP
    // signature alone (both will hit; Bricks adds its own extra evidence).
    weight: 1.3,
  },
  {
    // Elementor for WordPress. Detection: elementor-* class prefix on
    // every section/column/widget, plus the elementor body class
    // ("elementor-default", "elementor-page-XXXX") and asset path.
    stack: 'wordpress_elementor',
    htmlPatterns: [
      /class=["'][^"']*\belementor-(?:default|page|section|column|widget|element)\b/i,
      /\/wp-content\/plugins\/elementor\//i,
      /<meta name=["']generator["'][^>]*Elementor/i,
    ],
    generatorPatterns: [/Elementor/i],
    weight: 1.3,
  },
  {
    // Divi (Elegant Themes) for WordPress. Detection: et_pb_* class
    // prefix on every Divi module + Divi theme asset path.
    stack: 'wordpress_divi',
    htmlPatterns: [
      /class=["'][^"']*\bet_pb_/i,
      /\/wp-content\/themes\/Divi\//i,
      /<meta name=["']generator["'][^>]*Divi/i,
    ],
    generatorPatterns: [/Divi/i],
    weight: 1.3,
  },
  {
    stack: 'nextjs',
    htmlPatterns: [/__NEXT_DATA__/, /\/_next\/static\//, /<script[^>]*\/_next\/(static|data)/],
    headerPatterns: [
      { name: 'x-powered-by', value: /Next\.js/i },
      { name: 'x-nextjs-prerender', value: /./ },
    ],
    weight: 0.9,
  },
  {
    stack: 'nuxt',
    htmlPatterns: [/window\.__NUXT__/, /\/_nuxt\//],
    weight: 0.9,
  },
  {
    stack: 'gatsby',
    htmlPatterns: [
      /___gatsby/,
      /\/gatsby-(?:framework|chunk-mapping)\b/,
      /<meta name=["']generator["'][^>]*Gatsby/i,
    ],
    generatorPatterns: [/Gatsby/i],
    weight: 0.9,
  },
  {
    stack: 'astro',
    htmlPatterns: [/data-astro-/i, /astro:scripts/, /<meta name=["']generator["'][^>]*Astro/i],
    generatorPatterns: [/Astro/i],
    weight: 0.9,
  },
  {
    stack: 'drupal',
    htmlPatterns: [
      /Drupal\.settings/i,
      /\/sites\/default\/files\//i,
      /<meta name=["']generator["'][^>]*Drupal/i,
    ],
    generatorPatterns: [/Drupal/i],
    weight: 1,
  },
  {
    stack: 'joomla',
    htmlPatterns: [/\/media\/system\/js\/core\.js/, /<meta name=["']generator["'][^>]*Joomla/i],
    generatorPatterns: [/Joomla/i],
    weight: 1,
  },
  {
    stack: 'prestashop',
    htmlPatterns: [/PrestaShop/i, /\/themes\/[^"']+\/assets\/css\/theme\.css/],
    generatorPatterns: [/PrestaShop/i],
    weight: 1,
  },
  {
    stack: 'magento',
    htmlPatterns: [/Magento_/i, /\/static\/version\d+\/frontend\//i, /mage\/cookies\.js/],
    generatorPatterns: [/Magento/i],
    weight: 1,
  },
  {
    stack: 'react_generic',
    htmlPatterns: [/<div id=["']root["']/, /react-dom/, /data-reactroot/],
    weight: 0.4,
  },
  {
    stack: 'vue_generic',
    htmlPatterns: [/<div id=["']app["']/, /vue\.runtime/, /v-app/],
    weight: 0.3,
  },
];

interface DetectInput {
  html: string;
  responseHeaders: Record<string, string>;
  cookieHeader?: string;
  generatorMeta?: string | null;
}

export function detectStack(input: DetectInput): StackSignal {
  const evidenceByStack = new Map<DetectedStack, { score: number; hits: string[] }>();

  for (const sig of SIGNATURES) {
    let score = 0;
    const hits: string[] = [];

    if (sig.htmlPatterns) {
      for (const re of sig.htmlPatterns) {
        if (re.test(input.html)) {
          score += sig.weight;
          hits.push(`html:${re.source.slice(0, 40)}`);
        }
      }
    }

    if (sig.headerPatterns) {
      for (const { name, value } of sig.headerPatterns) {
        const header = input.responseHeaders[name.toLowerCase()];
        if (header && value.test(header)) {
          score += sig.weight * 1.5;
          hits.push(`header:${name}=${header.slice(0, 40)}`);
        }
      }
    }

    if (sig.generatorPatterns && input.generatorMeta) {
      for (const re of sig.generatorPatterns) {
        if (re.test(input.generatorMeta)) {
          score += sig.weight * 2;
          hits.push(`generator:${input.generatorMeta.slice(0, 40)}`);
        }
      }
    }

    if (score > 0) {
      const prev = evidenceByStack.get(sig.stack) ?? { score: 0, hits: [] };
      evidenceByStack.set(sig.stack, {
        score: prev.score + score,
        hits: [...prev.hits, ...hits],
      });
    }
  }

  if (evidenceByStack.size === 0) {
    return { stack: 'unknown', confidence: 0, evidence: [] };
  }

  const ranked = [...evidenceByStack.entries()].sort((a, b) => b[1].score - a[1].score);
  const top = ranked[0];
  if (!top) {
    return { stack: 'unknown', confidence: 0, evidence: [] };
  }
  const [winnerStack, winnerData] = top;

  // confidence cap at 1, normalized against a generous 3.0 ceiling
  const confidence = Math.min(1, winnerData.score / 3);

  return {
    stack: winnerStack,
    confidence,
    evidence: winnerData.hits.slice(0, 6),
  };
}
