import { describe, expect, it } from 'vitest';

import { tryParseJson } from '../src/audit/llm/client.js';

describe('tryParseJson', () => {
  it('parses clean JSON', () => {
    const r = tryParseJson('{"a":1,"b":[2,3]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1, b: [2, 3] });
  });

  it('strips a json code fence', () => {
    const r = tryParseJson('```json\n{"a":1}\n```');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('recovers JSON with a trailing comma in an array', () => {
    const r = tryParseJson('{"items":["x","y",]}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ items: ['x', 'y'] });
  });

  it('recovers JSON with a trailing comma in an object', () => {
    const r = tryParseJson('{"a":1,"b":2,}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1, b: 2 });
  });

  it('recovers a JSON object preceded by prose', () => {
    const r = tryParseJson('Voici le rapport :\n{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('fails on genuinely malformed JSON (missing comma between elements)', () => {
    const r = tryParseJson('{"items":["x" "y"]}');
    expect(r.ok).toBe(false);
  });

  it('fails when there is no JSON at all', () => {
    const r = tryParseJson('pas de json ici');
    expect(r.ok).toBe(false);
  });
});
