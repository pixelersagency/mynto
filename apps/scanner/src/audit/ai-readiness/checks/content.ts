import type { AiCheckResult } from '@mynto/shared';

import { probe, probeFirstOk } from '../probe.js';
import { buildCheck, probeEvidence, type AiAuditContext } from '../types.js';

/**
 * Content accessibility: once an agent has found the site, can it get the
 * content without running a browser?
 */
export async function runContentChecks(ctx: AiAuditContext): Promise<AiCheckResult[]> {
  const [markdown, llmsTxt] = await Promise.all([checkMarkdownNegotiation(ctx), checkLlmsTxt(ctx)]);
  return [markdown, llmsTxt, checkNoJsContent(ctx)];
}

/**
 * Markdown for agents: `Accept: text/markdown` on the page, plus the
 * `.md` suffix convention. Either one counts.
 */
async function checkMarkdownNegotiation(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = [
    'https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/',
  ];
  const fixPrompt = [
    'Propose une version Markdown de tes pages publiques :',
    'renvoie du text/markdown quand la requête contient Accept: text/markdown,',
    'et rends la même page disponible avec le suffixe .md.',
    'Signale-la avec un en-tête Link: </page.md>; rel="alternate"; type="text/markdown".',
  ].join(' ');

  const negotiated = await probe(ctx.targetUrl, { accept: 'text/markdown' });
  if (isMarkdown(negotiated)) {
    return buildCheck({
      id: 'markdown_negotiation',
      status: 'pass',
      message: 'Le site renvoie du Markdown quand un agent le demande.',
      evidence: [probeEvidence('GET page cible (Accept: text/markdown)', negotiated)],
      specUrls,
    });
  }

  const suffixed = await probeFirstOk(markdownSuffixCandidates(ctx.targetUrl), {
    accept: 'text/markdown,text/plain,*/*',
  });
  const suffixHit = suffixed.find(isMarkdown);
  if (suffixHit) {
    return buildCheck({
      id: 'markdown_negotiation',
      status: 'pass',
      message: 'Une version Markdown de la page existe avec le suffixe .md.',
      evidence: [probeEvidence('GET variante .md', suffixHit)],
      specUrls,
    });
  }

  return buildCheck({
    id: 'markdown_negotiation',
    status: 'fail',
    message: 'Pas de version Markdown : un agent doit lire tout ton HTML.',
    evidence: [
      probeEvidence('GET page cible (Accept: text/markdown)', negotiated),
      ...suffixed.map((r) => probeEvidence('GET variante .md', r)),
    ],
    specUrls,
    fixPrompt,
  });
}

async function checkLlmsTxt(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://llmstxt.org/'];
  const tried = await probeFirstOk(
    [`${ctx.origin}/llms.txt`, `${ctx.origin}/.well-known/llms.txt`],
    { accept: 'text/plain,text/markdown,*/*' },
  );
  const found = tried.find(
    (r) => r.ok && !r.contentType.includes('html') && r.body.trim().length > 0,
  );

  if (!found) {
    return buildCheck({
      id: 'llms_txt',
      status: 'fail',
      message: 'Pas de fichier llms.txt : aucun résumé de ton site pour les modèles d’IA.',
      evidence: tried.map((r) => probeEvidence('GET llms.txt', r)),
      specUrls,
      fixPrompt: [
        'Publie un fichier /llms.txt en Markdown : un titre H1 avec le nom du site,',
        'un paragraphe qui dit ce que tu fais et pour qui,',
        'puis des listes de liens vers tes pages clés, chacun avec une courte description.',
      ].join(' '),
    });
  }

  const hasHeading = /^#\s+\S/m.test(found.body);
  const hasLinks = /\[[^\]]+\]\([^)]+\)/.test(found.body);
  if (!hasHeading || !hasLinks) {
    return buildCheck({
      id: 'llms_txt',
      status: 'pass',
      message: 'Fichier llms.txt présent mais incomplet : il manque le titre H1 ou les liens.',
      evidence: [probeEvidence('GET llms.txt', found)],
      specUrls,
    });
  }

  return buildCheck({
    id: 'llms_txt',
    status: 'pass',
    message: 'Fichier llms.txt présent et bien structuré.',
    evidence: [probeEvidence('GET llms.txt', found)],
    specUrls,
  });
}

const MIN_WORDS_WITHOUT_JS = 120;

/**
 * The single most expensive failure for an agent: a page whose HTML is an
 * empty shell. Measured on the raw HTML only (no Playwright here), which
 * is exactly what a fetch-based agent sees.
 */
function checkNoJsContent(ctx: AiAuditContext): AiCheckResult {
  const specUrls = [
    'https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/',
  ];
  const home = ctx.home;

  if (!home.ok) {
    return buildCheck({
      id: 'no_js_content',
      status: 'skipped',
      message: 'La page ne répond pas : contenu impossible à mesurer.',
      evidence: [probeEvidence('GET page cible', home)],
      specUrls,
    });
  }

  const words = countVisibleWords(home.body);
  const emptyShell = /<div[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(
    home.body,
  );

  if (words < MIN_WORDS_WITHOUT_JS || emptyShell) {
    return buildCheck({
      id: 'no_js_content',
      status: 'fail',
      message: `Seulement ${String(words)} mots lisibles sans JavaScript${
        emptyShell ? ' (la page n’est qu’une coquille vide)' : ''
      }. La plupart des agents ne verront rien.`,
      evidence: [
        {
          label: 'Mots dans le HTML brut',
          url: home.url,
          status: words,
          detail: emptyShell
            ? 'Conteneur racine vide détecté (SPA rendue côté client).'
            : undefined,
        },
      ],
      specUrls,
      fixPrompt: [
        'Mets le contenu principal dans le HTML envoyé par le serveur :',
        'passe la page en rendu côté serveur ou en pages statiques,',
        'ou propose aux agents une version Markdown ou HTML statique équivalente.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'no_js_content',
    status: 'pass',
    message: `${String(words)} mots lisibles sans exécuter de JavaScript.`,
    evidence: [{ label: 'Mots dans le HTML brut', url: home.url, status: words }],
    specUrls,
  });
}

function isMarkdown(res: { ok: boolean; contentType: string; body: string }): boolean {
  if (!res.ok) return false;
  if (res.contentType.includes('html')) return false;
  const isMarkdownType =
    res.contentType.includes('markdown') ||
    (res.contentType.includes('text/plain') && /^#{1,3}\s+\S/m.test(res.body));
  if (!isMarkdownType) return false;
  return res.body.trim().length > 0;
}

function markdownSuffixCandidates(target: string): string[] {
  try {
    const url = new URL(target);
    const path = url.pathname.replace(/\/+$/, '');
    const base = `${url.origin}${path}`;
    return path.length === 0 ? [`${url.origin}/index.md`] : [`${base}.md`, `${base}/index.md`];
  } catch {
    return [];
  }
}

/** Rough word count of the rendered-ish text, scripts and styles removed. */
function countVisibleWords(html: string): number {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length === 0) return 0;
  return text.split(' ').filter((w) => w.length > 1).length;
}

export const __testables = { countVisibleWords, markdownSuffixCandidates, isMarkdown };
