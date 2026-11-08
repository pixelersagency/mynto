// Bundles the stdio bin into one self-contained ESM file (dist/mynto-mcp.mjs)
// so Claude Desktop / Claude Code can run it with plain `node`.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/bin.ts'],
  outfile: 'dist/mynto-mcp.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
