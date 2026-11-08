// Copies the curated report fonts (latin, 400/600/700, woff2) from the
// @fontsource packages into public/fonts, so reports and PDFs never call a
// font CDN. Run after bumping a @fontsource package: pnpm --filter @mynto/web fonts:sync
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const FAMILIES = [
  'inter',
  'plus-jakarta-sans',
  'manrope',
  'dm-sans',
  'ibm-plex-sans',
  'source-serif-4',
  'fraunces',
  'merriweather',
];
const WEIGHTS = [400, 600, 700];
// Extra files for the dashboard (not offered to reports): Inter 500 for the
// UI, Newsreader 400/500 for page titles and big numbers.
const DASHBOARD = { inter: [500], newsreader: [400, 500] };
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts');
await mkdir(out, { recursive: true });
const licenses = [];
for (const fam of new Set([...FAMILIES, ...Object.keys(DASHBOARD)])) {
  const pkg = path.dirname(require.resolve(`@fontsource/${fam}/package.json`));
  const weights = [...(FAMILIES.includes(fam) ? WEIGHTS : []), ...(DASHBOARD[fam] ?? [])];
  for (const w of weights) {
    const file = `${fam}-latin-${String(w)}-normal.woff2`;
    await copyFile(path.join(pkg, 'files', file), path.join(out, file));
  }
  const meta = require(`@fontsource/${fam}/package.json`);
  // OFL-1.1 requires the copyright notice and license text to travel with
  // the font files.
  await copyFile(path.join(pkg, 'LICENSE'), path.join(out, `${fam}.LICENSE.txt`));
  licenses.push(
    `${fam}: ${meta.license ?? 'OFL-1.1'} (${meta.homepage ?? ''}), see ${fam}.LICENSE.txt`,
  );
}
await writeFile(
  path.join(out, 'LICENSES.txt'),
  `Fonts bundled from @fontsource packages (latin subset, woff2). SIL Open Font License 1.1.\n${licenses.join('\n')}\n`,
);
console.log(`fonts copied to ${out}`);
