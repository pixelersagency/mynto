import { describe, expect, it } from 'vitest';

import { acceptsTemperature, thinkingParams } from '../src/audit/llm/client.js';

describe('acceptsTemperature', () => {
  it('keeps temperature for Claude 4.x and older', () => {
    expect(acceptsTemperature('claude-sonnet-4-6')).toBe(true);
    expect(acceptsTemperature('claude-3-5-sonnet-latest')).toBe(true);
  });
  it('drops temperature for Claude 5 models', () => {
    expect(acceptsTemperature('claude-haiku-5-5')).toBe(false);
    expect(acceptsTemperature('claude-opus-5-5')).toBe(false);
  });
});

describe('thinkingParams', () => {
  it('disables thinking on Haiku 5.5', () => {
    expect(thinkingParams('claude-haiku-5-5')).toEqual({ thinking: { type: 'disabled' } });
  });
  it('lowers effort on Opus / Sonnet 5.x, where thinking cannot be disabled', () => {
    expect(thinkingParams('claude-opus-5-5')).toEqual({ output_config: { effort: 'low' } });
    expect(thinkingParams('claude-sonnet-5-5')).toEqual({ output_config: { effort: 'low' } });
  });
  it('sends nothing for Claude 4.x and older', () => {
    expect(thinkingParams('claude-sonnet-4-6')).toEqual({});
  });
});
