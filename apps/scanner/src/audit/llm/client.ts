import type { AuditFacts, AxisScore, Finding, SectorContext } from '../types.js';

import { ANTHROPIC_RESPONSE_SCHEMA, clampToLimits } from './anthropic-schema.js';
import {
  LlmAuditOutputSchema,
  type LlmAuditOutput,
  validateAgainstDeterministic,
} from './output-schema.js';
import { RESPONSE_JSON_SCHEMA, SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';

/**
 * LLM provider abstraction for the audit batch call.
 *
 * Routing rationale:
 *   - Gemini 2.5 Flash : default. 1M context, cheap ($0.075/$0.30 per M),
 *     ample free tier (1500 req/day on Google AI Studio), good FR.
 *   - Mistral Large    : fallback FR-native if Gemini unavailable.
 *   - Claude Sonnet    : "Pro tier" upgrade — strongest reasoning, best FR.
 *
 * The audit only emits ONE batch call per audit. Schema-validated output.
 * On validation failure: retry once with stricter system reminder, then
 * fall back to deterministic skeleton render (no LLM narrative).
 */

export type LlmProvider = 'gemini' | 'mistral' | 'anthropic';

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface RunInput {
  facts: AuditFacts;
  findings: Finding[];
  scores: AxisScore[];
  sectorHints: Partial<SectorContext>;
  internalPagesSample: string[];
  homeHtmlExcerpt: string;
}

export interface RunOutcome {
  ok: boolean;
  output?: LlmAuditOutput;
  error?: string;
  rawResponse?: string;
  tokensIn?: number;
  tokensOut?: number;
  provider: LlmProvider;
  model: string;
  durationMs: number;
  /** Number of provider calls made (1 = first try succeeded, 2 = retry used). */
  attempts: number;
}

/**
 * Appended to the system prompt on the retry attempt. The first call was
 * rejected (invalid JSON, schema violation, or hallucinated id); this spells
 * out the hard constraints the model violated most often in production.
 */
const RETRY_SYSTEM_REMINDER = `
RAPPEL STRICT - ta réponse précédente a été rejetée par la validation.
Tu DOIS impérativement :
- Émettre UNIQUEMENT du JSON valide : rien avant, rien après, aucun bloc de code markdown, aucune virgule traînante.
- Respecter chaque limite de longueur du schéma. En particulier : chaque entrée de "killerFindings" <= 80 caractères, "sector.detected" <= 80 caractères.
- "top3Priorities" : exactement 3 éléments, "findingIds" <= 8 entrées par élément.
- N'utiliser que des "findingId" présents dans la liste de findings fournie. Ne jamais inventer d'identifiant.
`.trim();

export async function runAuditLlm(input: RunInput, config: LlmConfig): Promise<RunOutcome> {
  const knownIds = new Set(input.findings.map((f) => f.id));
  const userPrompt = buildUserPrompt(input);
  const started = Date.now();
  const maxAttempts = 2;

  // First attempt: base system prompt.
  let last = await attemptAuditLlm(SYSTEM_PROMPT, userPrompt, knownIds, config, started, 1);
  if (last.ok) return last;

  // Retries: append the strict reminder so the model corrects the class of
  // error that got the prior call rejected (most failures are length-cap or
  // invalid-JSON, not random noise).
  const retrySystem = `${SYSTEM_PROMPT}\n\n${RETRY_SYSTEM_REMINDER}`;
  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    last = await attemptAuditLlm(retrySystem, userPrompt, knownIds, config, started, attempt);
    if (last.ok) return last;
  }

  // All attempts exhausted — return the last failure (pipeline falls back to
  // the deterministic skeleton).
  return last;
}

async function attemptAuditLlm(
  system: string,
  userPrompt: string,
  knownIds: Set<string>,
  config: LlmConfig,
  started: number,
  attempt: number,
): Promise<RunOutcome> {
  let raw: string;
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    switch (config.provider) {
      case 'gemini': {
        const r = await callGemini(system, userPrompt, config);
        raw = r.text;
        tokensIn = r.tokensIn;
        tokensOut = r.tokensOut;
        break;
      }
      case 'mistral': {
        const r = await callMistral(system, userPrompt, config);
        raw = r.text;
        tokensIn = r.tokensIn;
        tokensOut = r.tokensOut;
        break;
      }
      case 'anthropic': {
        const r = await callAnthropic(system, userPrompt, config);
        raw = r.text;
        tokensIn = r.tokensIn;
        tokensOut = r.tokensOut;
        break;
      }
      default:
        return {
          ok: false,
          error: `unknown_provider:${config.provider as string}`,
          provider: config.provider,
          model: config.model,
          durationMs: Date.now() - started,
          attempts: attempt,
        };
    }
  } catch (e) {
    return {
      ok: false,
      error: `llm_call_failed:${(e as Error).message}`,
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - started,
      attempts: attempt,
    };
  }

  const parsed = tryParseJson(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      error: `llm_invalid_json:${parsed.error}`,
      rawResponse: raw.slice(0, 2000),
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - started,
      tokensIn,
      tokensOut,
      attempts: attempt,
    };
  }

  // Claude structured outputs enforce shape but not lengths: trim overflow first.
  const candidate = config.provider === 'anthropic' ? clampToLimits(parsed.value) : parsed.value;
  const zodResult = LlmAuditOutputSchema.safeParse(candidate);
  if (!zodResult.success) {
    return {
      ok: false,
      error: `llm_schema_violation:${zodResult.error.issues.map((i) => i.path.join('.') + ':' + i.message).join(';')}`,
      rawResponse: raw.slice(0, 2000),
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - started,
      tokensIn,
      tokensOut,
      attempts: attempt,
    };
  }

  const crossCheck = validateAgainstDeterministic(zodResult.data, knownIds);
  if (crossCheck) {
    return {
      ok: false,
      error: `llm_hallucination:${crossCheck}`,
      rawResponse: raw.slice(0, 2000),
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - started,
      tokensIn,
      tokensOut,
      attempts: attempt,
    };
  }

  const sanitized = LlmAuditOutputSchema.safeParse(
    sanitizeAuditNarrative(zodResult.data, knownIds),
  );
  if (!sanitized.success) {
    // Let the existing retry / deterministic fallback handle unusable prose.
    return {
      ok: false,
      error: 'llm_sanitized_schema_violation',
      provider: config.provider,
      model: config.model,
      durationMs: Date.now() - started,
      tokensIn,
      tokensOut,
      attempts: attempt,
    };
  }

  return {
    ok: true,
    output: sanitized.data,
    provider: config.provider,
    model: config.model,
    durationMs: Date.now() - started,
    tokensIn,
    tokensOut,
    attempts: attempt,
  };
}

/** Clean reader-facing prose only; IDs, enums and code remain machine-exact. */
export function sanitizeAuditNarrative(
  output: LlmAuditOutput,
  knownIds: Set<string>,
): LlmAuditOutput {
  const codes = new Set([...knownIds].flatMap((id) => [id, id.split(':')[0] ?? id]));
  const escaped = [...codes]
    .sort((a, b) => b.length - a.length)
    .map((code) => code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const rule = escaped.length
    ? new RegExp(`(?<![\\w./-])(?:${escaped.join('|')})(?![\\w:-]|\\.[\\w])`, 'g')
    : null;
  const cleanText = (text: string): string => {
    const clean = (part: string): string => {
      let result = rule ? part.replace(rule, '') : part;
      result = result.replace(/\bfindings\b/gi, 'constats').replace(/\bfinding\b/gi, 'constat');
      return result
        .replace(/([([])\s*[,;:]\s*/g, '$1')
        .replace(/[,;:]\s*([)\]])/g, '$1')
        .replace(/\(\s*\)|\[\s*\]/g, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([,.;:!?])/g, '$1');
    };
    // Protect literals before touching prose. Restore after trimming so even
    // leading indentation and trailing newlines inside code stay byte-exact.
    const literals: string[] = [];
    let marker = '\u0000';
    while (text.includes(marker)) marker += '\u0000';
    const protect = (literal: string): string => {
      literals.push(literal);
      return `${marker}${String(literals.length - 1)}${marker}`;
    };
    const inlineCode = /(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g;
    const inlineRanges = [...text.matchAll(inlineCode)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
    const openingFence = /^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/gm;
    let protectedText = '';
    let cursor = 0;
    for (let match = openingFence.exec(text); match; match = openingFence.exec(text)) {
      // A closing delimiter of a multiline inline span is not a new fence.
      if (inlineRanges.some((span) => span.start < match.index && match.index < span.end)) continue;
      const delimiter = match[1];
      if (!delimiter) continue;
      // Backtick fence info strings cannot themselves contain backticks.
      if (delimiter.startsWith('`') && match[0].trimStart().slice(delimiter.length).includes('`'))
        continue;
      const closingFence = new RegExp(
        `^ {0,3}${delimiter.charAt(0)}{${String(delimiter.length)},}[ \\t]*(?:\\r?\\n|$)`,
        'gm',
      );
      closingFence.lastIndex = openingFence.lastIndex;
      const closing = closingFence.exec(text);
      const end = closing ? closingFence.lastIndex : text.length;
      protectedText += text.slice(cursor, match.index) + protect(text.slice(match.index, end));
      cursor = end;
      openingFence.lastIndex = end;
    }
    protectedText += text.slice(cursor);
    protectedText = protectedText
      // Markdown indentation blocks, including tabs. Blank separator lines
      // remain outside the block; each indented run is independently protected.
      .replace(/^(?:(?: {4}|\t)[^\r\n]*(?:\r?\n|$))+/gm, protect)
      .replace(inlineCode, (span: string, _delimiter: string, content: string) =>
        codes.has(content) ? '' : protect(span),
      )
      // Keep both absolute URL tokens and Markdown destinations (also relative).
      .replace(/\]\((?:\\.|[^\\\n)])*\)/g, protect)
      .replace(/\b(?:https?:\/\/|mailto:|www\.)[^\s<>"`]+/gi, protect);
    let cleaned = clean(protectedText).trim();
    // Later literals can contain earlier protected spans, so unwrap in reverse.
    for (let index = literals.length - 1; index >= 0; index--) {
      cleaned = cleaned.replaceAll(
        `${marker}${String(index)}${marker}`,
        () => literals[index] ?? '',
      );
    }
    return cleaned;
  };
  return {
    ...output,
    sector: {
      ...output.sector,
      audienceNotes: cleanText(output.sector.audienceNotes),
    },
    execSummary: cleanText(output.execSummary),
    estimatedImpactNarrative: cleanText(output.estimatedImpactNarrative),
    quickWins: output.quickWins.map(cleanText),
    killerFindings: [...output.killerFindings],
    top3Priorities: output.top3Priorities.map((priority) => ({
      ...priority,
      title: cleanText(priority.title),
      reason: cleanText(priority.reason),
      ...(priority.expectedOutcome === undefined
        ? {}
        : { expectedOutcome: cleanText(priority.expectedOutcome) }),
    })),
    findings: output.findings.map((finding) => ({
      ...finding,
      title: cleanText(finding.title),
      constat: cleanText(finding.constat),
      impactBusiness: cleanText(finding.impactBusiness),
      recommandation: cleanText(finding.recommandation),
    })),
  };
}

export function tryParseJson(
  raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const stripped = stripCodeFences(raw).trim();

  // Attempt order, from least to most lenient:
  //   1. raw stripped text
  //   2. trailing commas removed (a frequent Gemini structured-output defect)
  //   3. first {...} substring (some models prepend prose)
  //   4. first {...} substring with trailing commas removed
  const candidates = [
    stripped,
    stripTrailingCommas(stripped),
    /\{[\s\S]*\}/.exec(stripped)?.[0],
    stripTrailingCommas(/\{[\s\S]*\}/.exec(stripped)?.[0] ?? ''),
  ];

  let lastError = 'no parseable JSON found';
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch (e) {
      lastError = (e as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}

/** Removes commas that directly precede a closing `}` or `]`. Safe: a comma
 *  in that position is always invalid JSON, never meaningful. */
function stripTrailingCommas(s: string): string {
  return s.replace(/,(\s*[}\]])/g, '$1');
}

interface ProviderResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

async function callGemini(system: string, user: string, cfg: LlmConfig): Promise<ProviderResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    systemInstruction: { role: 'system', parts: [{ text: system }] },
    generationConfig: {
      temperature: cfg.temperature ?? 0.3,
      maxOutputTokens: cfg.maxOutputTokens ?? 8192,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_JSON_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gemini_http_${res.status.toString()}:${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new Error('gemini_empty_response');

  return {
    text,
    tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

async function callMistral(
  system: string,
  user: string,
  cfg: LlmConfig,
): Promise<ProviderResponse> {
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: cfg.temperature ?? 0.3,
    max_tokens: cfg.maxOutputTokens ?? 8192,
    response_format: { type: 'json_object' },
  };

  const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`mistral_http_${res.status.toString()}:${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('mistral_empty_response');

  return {
    text,
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  };
}

/** Claude 4.x and earlier take `temperature`; from the 5 family on it is refused. */
export function acceptsTemperature(model: string): boolean {
  const m = /^claude-(?:[a-z]+-)?(\d+)/.exec(model);
  return !m || Number(m[1]) < 5;
}

/**
 * Claude 5 models think by default and those thinking tokens count against
 * max_tokens: the report narrative could end with no text block at all.
 * The narrative is rewriting work, not judgement, so it runs without
 * thinking: Haiku 5.x accepts `thinking: disabled` (at its default `medium`
 * effort); Opus / Sonnet 5.x refuse it and get the lowest effort instead.
 * (The vision call keeps thinking on: design / UI / UX is where it helps.)
 */
export function thinkingParams(model: string): Record<string, unknown> {
  const m = /^claude-(?:([a-z]+)-)?(\d+)/.exec(model);
  if (!m || Number(m[2]) < 5) return {};
  if (m[1] === 'haiku') return { thinking: { type: 'disabled' } };
  return { output_config: { effort: 'low' } };
}

/** Models with Claude structured outputs: the 5 family, Opus 4.8 and Haiku 4.5. */
export function supportsStructuredOutput(model: string): boolean {
  const m = /^claude-(?:[a-z]+-)?(\d+)/.exec(model);
  if (m && Number(m[1]) >= 5) return true;
  return model.startsWith('claude-opus-4-8') || model.startsWith('claude-haiku-4-5');
}

async function callAnthropic(
  system: string,
  user: string,
  cfg: LlmConfig,
): Promise<ProviderResponse> {
  // Recent Claude models (Haiku 5.5 and later) reject `temperature`
  // ("deprecated for this model"); older ones still accept it.
  const { thinking, output_config: outputConfig } = thinkingParams(cfg.model) as {
    thinking?: unknown;
    output_config?: Record<string, unknown>;
  };
  const body = {
    model: cfg.model,
    max_tokens: cfg.maxOutputTokens ?? 8192,
    ...(acceptsTemperature(cfg.model) ? { temperature: cfg.temperature ?? 0.3 } : {}),
    ...(thinking ? { thinking } : {}),
    // Structured output (where supported): the API guarantees the JSON shape.
    ...(supportsStructuredOutput(cfg.model)
      ? {
          output_config: {
            ...outputConfig,
            format: { type: 'json_schema', schema: ANTHROPIC_RESPONSE_SCHEMA },
          },
        }
      : outputConfig
        ? { output_config: outputConfig }
        : {}),
    system,
    messages: [{ role: 'user', content: user }],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': cfg.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`anthropic_http_${res.status.toString()}:${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text =
    data.content
      ?.filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('') ?? '';
  if (!text) {
    const blocks = (data.content ?? []).map((c) => c.type).join(',');
    throw new Error(`anthropic_empty_response:stop=${data.stop_reason ?? '?'}:blocks=${blocks}`);
  }

  return {
    text,
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
  };
}
