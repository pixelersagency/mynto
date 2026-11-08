import { checkUrlSafe } from '../../lib/url-guard.js';
import type { RobotsFacts } from '../types.js';

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 256_000;
const AI_BOT_PATTERNS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-Web',
  'Anthropic-AI',
  'CCBot',
  'Google-Extended',
  'PerplexityBot',
  'Bytespider',
  'FacebookBot',
  'Applebot-Extended',
  'cohere-ai',
  'Diffbot',
  'ImagesiftBot',
  'omgili',
];

export async function fetchRobots(origin: string, userAgent: string): Promise<RobotsFacts> {
  const url = `${origin}/robots.txt`;
  const safe = await checkUrlSafe(url);
  if (!safe.ok) {
    return defaultFacts(url);
  }

  const body = await fetchText(url, userAgent);
  if (body === null) {
    return defaultFacts(url);
  }

  const lower = body.toLowerCase();
  const lines = body.split(/\r?\n/);

  let hasSitemapDirective = false;
  let hasDisallowAll = false;
  let currentAgents: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      currentAgents = [value];
    } else if (directive === 'sitemap') {
      hasSitemapDirective = true;
    } else if (directive === 'disallow') {
      if (currentAgents.includes('*') && (value === '/' || value === '/*')) {
        hasDisallowAll = true;
      }
    }
  }

  const blocksAiBots: string[] = [];
  for (const bot of AI_BOT_PATTERNS) {
    const re = new RegExp(`user-agent:\\s*${escapeRegex(bot)}[\\s\\S]*?disallow:\\s*/`, 'i');
    if (re.test(lower)) blocksAiBots.push(bot);
  }

  return {
    present: true,
    url,
    content: body.slice(0, 10_000),
    blocksAiBots,
    hasSitemapDirective,
    hasDisallowAll,
  };
}

function defaultFacts(url: string): RobotsFacts {
  return {
    present: false,
    url,
    content: null,
    blocksAiBots: [],
    hasSitemapDirective: false,
    hasDisallowAll: false,
  };
}

async function fetchText(url: string, userAgent: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/plain,*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
