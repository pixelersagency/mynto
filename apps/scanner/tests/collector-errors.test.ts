import { beforeEach, expect, it, vi } from 'vitest';

import { collectAll } from '../src/audit/collectors/index.js';

import { makeBaseFacts } from './helpers/base-facts.js';

const mocks = vi.hoisted(() => ({
  lighthouse: vi.fn(),
  axe: vi.fn(),
  vision: vi.fn(),
  design: vi.fn(),
}));
vi.mock('../src/logger.js', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock('../src/audit/collectors/lighthouse.js', () => ({ runLighthouse: mocks.lighthouse }));
vi.mock('../src/audit/collectors/axe.js', () => ({ runAxe: mocks.axe }));
vi.mock('../src/audit/collectors/design-measurements.js', () => ({
  collectDesignMeasurements: mocks.design,
}));
vi.mock('../src/audit/collectors/vision.js', () => ({ collectVision: mocks.vision }));
vi.mock('../src/audit/collectors/http.js', async () => {
  const { makeBaseFacts } = await import('./helpers/base-facts.js');
  return {
    AUDIT_USER_AGENT: 'test',
    probeUrl: () =>
      Promise.resolve({
        facts: makeBaseFacts().http,
        html: '<!doctype html><html><head><title>Test</title></head><body><h1>Test</h1></body></html>',
      }),
  };
});
vi.mock('../src/audit/collectors/render-html.js', () => ({
  renderHtml: () => Promise.resolve(null),
}));
vi.mock('../src/audit/collectors/crawl.js', () => ({
  fetchInternalSample: () => Promise.resolve([]),
}));
vi.mock('../src/audit/collectors/robots.js', () => ({ fetchRobots: () => Promise.resolve(null) }));
vi.mock('../src/audit/collectors/sitemap-discovery.js', async () => {
  const { makeBaseFacts } = await import('./helpers/base-facts.js');
  return { discoverSitemap: () => Promise.resolve(makeBaseFacts().sitemap) };
});
vi.mock('../src/audit/collectors/legal.js', async () => {
  const { makeBaseFacts } = await import('./helpers/base-facts.js');
  return { collectLegal: () => Promise.resolve(makeBaseFacts().legal) };
});
vi.mock('../src/audit/collectors/conversion.js', async () => {
  const { makeBaseFacts } = await import('./helpers/base-facts.js');
  return { collectConversion: () => Promise.resolve(makeBaseFacts().conversion) };
});

beforeEach(() => {
  vi.resetAllMocks();
  const base = makeBaseFacts();
  mocks.lighthouse.mockResolvedValue({
    ...base.lighthouse,
    errorCode: 'lighthouse_runtime_NO_FCP',
  });
  mocks.axe.mockResolvedValue(base.axe);
  mocks.vision.mockResolvedValue(base.vision);
  mocks.design.mockResolvedValue({ fetched: false, viewports: [] });
});

it('persists soft failures even when collectors do not throw', async () => {
  const { facts } = await collectAll('https://example.com', {
    runLighthouse: true,
    runAxe: true,
    vision: { apiKey: 'private-key' },
  });
  expect(facts.errors).toEqual(
    expect.arrayContaining([
      { phase: 'lighthouse', message: 'lighthouse_runtime_NO_FCP' },
      { phase: 'axe', message: 'axe_unavailable' },
      { phase: 'vision', message: 'vision_capture_unavailable' },
    ]),
  );
  expect(JSON.stringify(facts.errors)).not.toContain('private-key');
});

it('does not persist raw exception messages or duplicate collector failures', async () => {
  mocks.lighthouse.mockRejectedValue(new Error('token=private'));
  mocks.axe.mockRejectedValue(new Error('email=private@example.com'));
  mocks.vision.mockRejectedValue(new Error('Authorization: private'));
  const { facts } = await collectAll('https://example.com', {
    runLighthouse: true,
    runAxe: true,
    vision: { apiKey: 'private' },
  });
  expect(facts.errors.filter((e) => ['lighthouse', 'axe', 'vision'].includes(e.phase))).toEqual([
    { phase: 'lighthouse', message: 'lighthouse_exception' },
    { phase: 'axe', message: 'axe_exception' },
    { phase: 'vision', message: 'vision_exception' },
  ]);
  expect(JSON.stringify(facts.errors)).not.toContain('private');
});

it('distinguishes disabled/unconfigured collectors from attempted measurements', async () => {
  const { facts } = await collectAll('https://example.com');
  expect(facts.errors).toEqual(
    expect.arrayContaining([
      { phase: 'lighthouse', message: 'lighthouse_disabled' },
      { phase: 'axe', message: 'axe_disabled' },
      { phase: 'vision', message: 'vision_disabled_or_unconfigured' },
    ]),
  );
  expect(mocks.lighthouse).not.toHaveBeenCalled();
  expect(mocks.axe).not.toHaveBeenCalled();
  expect(mocks.vision).not.toHaveBeenCalled();
});

it('runs deterministic design measurements independently of Vision and keeps partial facts', async () => {
  const { facts } = await collectAll('https://example.com', { runDesignMeasurements: true });
  expect(mocks.design).toHaveBeenCalledWith('https://example.com');
  expect(mocks.vision).not.toHaveBeenCalled();
  expect(facts.designMeasurements).toEqual({ fetched: false, viewports: [] });
  expect(facts.errors).toContainEqual({
    phase: 'design_measurements',
    message: 'design_measurements_incomplete',
  });
});
