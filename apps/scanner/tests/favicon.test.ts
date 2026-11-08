import { describe, expect, it } from 'vitest';

import { iconCandidates, sniffIcon } from '../src/lib/favicon-parse.js';

describe('favicon', () => {
  it('prefers sized PNG icons, skips SVG and data URLs, falls back to /favicon.ico', () => {
    const html = `
      <link rel="icon" href="/icon.svg" type="image/svg+xml">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <link rel="shortcut icon" href="/favicon-16.png" sizes="16x16">
      <link rel="apple-touch-icon" href="https://cdn.example.com/apple.png" sizes="180x180">`;
    expect(iconCandidates(html, 'https://www.acme.fr/page')).toEqual([
      'https://cdn.example.com/apple.png',
      'https://www.acme.fr/favicon-16.png',
      'https://www.acme.fr/favicon.ico',
    ]);
  });

  it('recognises raster formats by magic bytes only', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const ico = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 0, 0]);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(sniffIcon(png)).toBe('png');
    expect(sniffIcon(ico)).toBe('ico');
    expect(sniffIcon(svg)).toBeNull();
  });
});
