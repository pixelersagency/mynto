import type { EffectiveAiConfig } from '@mynto/db';

import type { LlmConfig } from '../audit/llm/client.js';

/**
 * LLM config for the narrative call, shared by the full-audit processor
 * (synchronous narrative) and the Radar interpretation (deferred narrative).
 * Built from the effective AI config (dashboard settings, env fallback).
 */

/** True when the narrative provider has an API key. */
export function hasLlmKey(ai: EffectiveAiConfig): boolean {
  return ai.narrative.apiKey !== null && ai.narrative.apiKey.length > 0;
}

export function pickLlmConfig(ai: EffectiveAiConfig): LlmConfig {
  return {
    provider: ai.narrative.provider,
    model: ai.narrative.model,
    // Pipeline falls back to deterministic skeleton if key is missing,
    // so we never block an audit on the LLM step.
    apiKey: ai.narrative.apiKey ?? 'missing-key',
    temperature: 0.3,
    // Headroom for Lighthouse + axe payloads. Most audits use 4-6K out
    // but a site with 20 axe violations + dense findings can push past 10K.
    maxOutputTokens: 16384,
  };
}
