import { describe, expect, it } from 'vitest';

import {
  PRIVATE_AUDIT_COLUMNS,
  PUBLIC_AUDIT_COLUMNS,
  PUBLIC_AUDIT_SUMMARY_COLUMNS,
  PUBLIC_FINDING_COLUMNS,
} from '../src/public-columns.js';

describe('public column allowlists', () => {
  it.each([
    ['PUBLIC_AUDIT_COLUMNS', PUBLIC_AUDIT_COLUMNS],
    ['PUBLIC_AUDIT_SUMMARY_COLUMNS', PUBLIC_AUDIT_SUMMARY_COLUMNS],
  ])('%s never exposes a private column', (_name, cols) => {
    for (const forbidden of ['email', 'llm_input', 'source']) {
      expect(cols).not.toContain(forbidden);
    }
    for (const priv of PRIVATE_AUDIT_COLUMNS) {
      expect(cols).not.toContain(priv);
    }
  });

  it('summary is a subset of the full public list', () => {
    for (const c of PUBLIC_AUDIT_SUMMARY_COLUMNS) {
      expect(PUBLIC_AUDIT_COLUMNS).toContain(c);
    }
  });

  it('public findings carry no audit_id', () => {
    expect(PUBLIC_FINDING_COLUMNS).not.toContain('audit_id');
  });
});
