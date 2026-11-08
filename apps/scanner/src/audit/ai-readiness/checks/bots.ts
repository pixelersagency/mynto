import type { AiCheckResult } from '@mynto/shared';

import { probe, simulatedBotUserAgent } from '../probe.js';
import { buildCheck, probeEvidence, type AiAuditContext } from '../types.js';

/** User-agents an agent-readiness report should care about, lowercased. */
const AI_USER_AGENTS = [
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'claudebot',
  'claude-user',
  'claude-searchbot',
  'anthropic-ai',
  'perplexitybot',
  'perplexity-user',
  'google-extended',
  'googleother',
  'ccbot',
  'bytespider',
  'meta-externalagent',
  'applebot-extended',
  'amazonbot',
  'cohere-ai',
  'mistralai-user',
] as const;

const CONTENT_SIGNAL_KEYS = ['ai-train', 'search', 'ai-input'] as const;

export async function runBotAccessChecks(ctx: AiAuditContext): Promise<AiCheckResult[]> {
  const [webBotAuth, liveAccess] = await Promise.all([
    checkWebBotAuth(ctx),
    checkLiveBotAccess(ctx),
  ]);
  return [checkAiBotRules(ctx), checkContentSignals(ctx), webBotAuth, liveAccess];
}

/**
 * An explicit rule (allow or disallow) is what counts here. Silence is the
 * failure: an agent that finds no rule for its user-agent has to guess.
 */
function checkAiBotRules(ctx: AiAuditContext): AiCheckResult {
  const specUrls = ['https://www.rfc-editor.org/rfc/rfc9309.html'];
  const fixPrompt = [
    'Dans robots.txt, ajoute un bloc pour chaque robot d’IA que tu veux autoriser ou bloquer.',
    'Par exemple User-agent: GPTBot puis Allow: / (ou Disallow: /),',
    'et pareil pour ClaudeBot, PerplexityBot, Google-Extended et CCBot.',
    'Une règle claire vaut mieux que pas de règle.',
  ].join(' ');

  if (!ctx.robots.ok) {
    return buildCheck({
      id: 'ai_bot_rules',
      status: 'fail',
      message: 'Pas de fichier robots.txt, donc aucune règle pour les robots d’IA.',
      evidence: [probeEvidence('GET /robots.txt', ctx.robots)],
      specUrls,
      fixPrompt,
    });
  }

  const declared = declaredUserAgents(ctx.robots.body);
  const matched = AI_USER_AGENTS.filter((ua) => declared.includes(ua));

  if (matched.length === 0) {
    return buildCheck({
      id: 'ai_bot_rules',
      status: 'fail',
      message: 'robots.txt ne nomme aucun robot d’IA.',
      evidence: [probeEvidence('GET /robots.txt', ctx.robots)],
      specUrls,
      fixPrompt,
    });
  }

  return buildCheck({
    id: 'ai_bot_rules',
    status: 'pass',
    message: `Règles claires pour ${String(matched.length)} robots d’IA : ${matched.slice(0, 8).join(', ')}.`,
    evidence: [probeEvidence('GET /robots.txt', ctx.robots)],
    specUrls,
  });
}

/**
 * Content Signals: the per-purpose usage preference (ai-train / search /
 * ai-input) that robots.txt alone cannot express.
 */
function checkContentSignals(ctx: AiAuditContext): AiCheckResult {
  const specUrls = ['https://contentsignals.org/', 'https://blog.cloudflare.com/content-signals/'];
  const fixPrompt = [
    'Ajoute une ligne Content-Signal dans robots.txt pour dire ce que tu autorises,',
    'par exemple Content-Signal: ai-train=no, search=yes, ai-input=yes,',
    'dans le bloc User-agent: * en haut du fichier.',
  ].join(' ');

  if (!ctx.robots.ok) {
    return buildCheck({
      id: 'content_signals',
      status: 'fail',
      message: 'Pas de fichier robots.txt, donc pas de signaux de contenu.',
      evidence: [probeEvidence('GET /robots.txt', ctx.robots)],
      specUrls,
      fixPrompt,
    });
  }

  const lines = ctx.robots.body
    .split(/\r?\n/)
    .filter((line) => /^\s*content-signal\s*:/i.test(line))
    .map((line) => line.trim());

  if (lines.length === 0) {
    return buildCheck({
      id: 'content_signals',
      status: 'fail',
      message: 'robots.txt ne dit pas comment l’IA peut utiliser ton contenu (aucune ligne Content-Signal).',
      evidence: [probeEvidence('GET /robots.txt', ctx.robots)],
      specUrls,
      fixPrompt,
    });
  }

  const joined = lines.join(' ').toLowerCase();
  const declaredKeys = CONTENT_SIGNAL_KEYS.filter((key) => joined.includes(`${key}=`));

  return buildCheck({
    id: 'content_signals',
    status: 'pass',
    message: `Signaux de contenu déclarés : ${declaredKeys.join(', ')}.`,
    evidence: [
      { label: 'Content-Signal', url: ctx.robots.url, detail: lines.join(' | ').slice(0, 240) },
    ],
    specUrls,
  });
}

/**
 * Web Bot Auth is opt-in infrastructure, not a baseline expectation, so a
 * missing directory is `neutral` (weight 0) rather than a failure.
 */
async function checkWebBotAuth(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://blog.cloudflare.com/web-bot-auth/'];
  const res = await probe(`${ctx.origin}/.well-known/http-message-signatures-directory`, {
    accept: 'application/http-message-signatures-directory+json,application/json,*/*',
  });

  if (res.ok && res.body.trim().length > 0) {
    return buildCheck({
      id: 'web_bot_auth',
      status: 'pass',
      message: 'Annuaire Web Bot Auth en place : tu peux reconnaître les robots qui signent leurs requêtes.',
      evidence: [probeEvidence('GET /.well-known/http-message-signatures-directory', res)],
      specUrls,
    });
  }

  return buildCheck({
    id: 'web_bot_auth',
    status: 'neutral',
    message: 'Pas d’annuaire Web Bot Auth. Facultatif, non compté dans le score.',
    evidence: [probeEvidence('GET /.well-known/http-message-signatures-directory', res)],
    specUrls,
  });
}

/**
 * Declared intent versus reality: many sites allow GPTBot in robots.txt
 * while their WAF answers 403 to the same user-agent. This check does the
 * real request with two AI user-agents and compares to the baseline.
 */
async function checkLiveBotAccess(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://platform.openai.com/docs/bots'];
  // The UA carries the bot token so user-agent rules in a WAF actually
  // fire, but it never claims to *be* OpenAI or Anthropic: it is the
  // scanner's own UA (which names the install) plus a "simulating" note.
  // Impersonating a real crawler against a domain we do not own is not
  // ours to do.
  const agents = [
    { name: 'GPTBot', ua: simulatedBotUserAgent('GPTBot') },
    { name: 'ClaudeBot', ua: simulatedBotUserAgent('ClaudeBot') },
  ] as const;

  const results = await Promise.all(
    agents.map(async (agent) => ({
      name: agent.name,
      res: await probe(ctx.targetUrl, { userAgent: agent.ua, maxBytes: 64_000 }),
    })),
  );

  const evidence = results.map((r) => ({
    label: `GET page cible en ${r.name}`,
    url: r.res.url,
    status: r.res.status,
  }));

  if (!ctx.home.ok) {
    return buildCheck({
      id: 'ai_bot_live_access',
      status: 'skipped',
      message: 'La page ne répond pas, même à un navigateur classique.',
      evidence,
      specUrls,
    });
  }

  const blocked = results.filter((r) => isBlocked(r.res.status));
  if (blocked.length > 0) {
    return buildCheck({
      id: 'ai_bot_live_access',
      status: 'fail',
      message: `${blocked.map((b) => b.name).join(' et ')} ${blocked.length > 1 ? 'sont bloqués' : 'est bloqué'} (HTTP ${blocked
        .map((b) => String(b.res.status))
        .join(', ')}). Ton robots.txt les autorise peut-être, mais ton serveur les refuse.`,
      evidence,
      specUrls,
      fixPrompt: [
        'Vérifie ton pare-feu applicatif, ton CDN et tes règles de sécurité :',
        'GPTBot et ClaudeBot reçoivent une erreur 403 ou 429 alors que la page est publique.',
        'Autorise-les si tu veux apparaître dans les réponses des assistants IA.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'ai_bot_live_access',
    status: 'pass',
    message: 'GPTBot et ClaudeBot accèdent bien à la page.',
    evidence,
    specUrls,
  });
}

function isBlocked(status: number | 'error'): boolean {
  if (status === 'error') return false;
  return status === 401 || status === 403 || status === 405 || status === 429 || status >= 500;
}

function declaredUserAgents(robotsBody: string): string[] {
  const out: string[] = [];
  for (const line of robotsBody.split(/\r?\n/)) {
    const match = /^\s*user-agent\s*:\s*(.+?)\s*(?:#.*)?$/i.exec(line);
    const value = match?.[1];
    if (value !== undefined) out.push(value.toLowerCase());
  }
  return out;
}

export const __testables = { declaredUserAgents, isBlocked, AI_USER_AGENTS };
