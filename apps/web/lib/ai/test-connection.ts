import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider } from '@mynto/db';

/**
 * "Tester la connexion": the cheapest authenticated call per provider,
 * server side, with no token generated:
 *   - Anthropic: Models API, retrieve the configured model (official SDK);
 *   - Gemini: GET models/{model};
 *   - Mistral: GET /v1/models, then look for the configured model.
 * Messages never contain the key, and the key is never logged.
 */

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

const TIMEOUT_MS = 10_000;

async function testAnthropic(apiKey: string, model: string): Promise<ConnectionResult> {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: TIMEOUT_MS });
  try {
    const m = await client.models.retrieve(model);
    return { ok: true, message: `Connexion réussie. Modèle ${m.id} disponible.` };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, message: 'Clé refusée par Anthropic.' };
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, message: 'Clé valide mais sans accès à ce modèle.' };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { ok: false, message: `Clé valide, mais le modèle « ${model} » est inconnu.` };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, message: 'Limite de requêtes Anthropic atteinte. Réessaye plus tard.' };
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return { ok: false, message: 'Anthropic ne répond pas depuis ce serveur.' };
    }
    if (err instanceof Anthropic.APIError) {
      return { ok: false, message: `Anthropic répond une erreur ${String(err.status)}.` };
    }
    return { ok: false, message: 'Test impossible pour le moment.' };
  }
}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, cache: 'no-store' });
    return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function testGemini(apiKey: string, model: string): Promise<ConnectionResult> {
  const res = await getJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
    { 'x-goog-api-key': apiKey },
  );
  if (res === null) return { ok: false, message: 'Gemini ne répond pas depuis ce serveur.' };
  if (res.status === 200)
    return { ok: true, message: `Connexion réussie. Modèle ${model} disponible.` };
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return { ok: false, message: 'Clé refusée par Gemini.' };
  }
  if (res.status === 404) {
    return { ok: false, message: `Clé valide, mais le modèle « ${model} » est inconnu.` };
  }
  return { ok: false, message: `Gemini répond une erreur ${String(res.status)}.` };
}

async function testMistral(apiKey: string, model: string): Promise<ConnectionResult> {
  const res = await getJson('https://api.mistral.ai/v1/models', {
    Authorization: `Bearer ${apiKey}`,
  });
  if (res === null) return { ok: false, message: 'Mistral ne répond pas depuis ce serveur.' };
  if (res.status === 401 || res.status === 403)
    return { ok: false, message: 'Clé refusée par Mistral.' };
  if (res.status !== 200)
    return { ok: false, message: `Mistral répond une erreur ${String(res.status)}.` };
  const data = (res.body as { data?: { id?: unknown; aliases?: unknown }[] } | null)?.data ?? [];
  const known = data.some(
    (m) => m.id === model || (Array.isArray(m.aliases) && m.aliases.includes(model)),
  );
  return known
    ? { ok: true, message: `Connexion réussie. Modèle ${model} disponible.` }
    : { ok: false, message: `Clé valide, mais le modèle « ${model} » est inconnu.` };
}

export function testProviderConnection(
  provider: AiProvider,
  apiKey: string,
  model: string,
): Promise<ConnectionResult> {
  switch (provider) {
    case 'anthropic':
      return testAnthropic(apiKey, model);
    case 'gemini':
      return testGemini(apiKey, model);
    case 'mistral':
      return testMistral(apiKey, model);
  }
}
