import globals from 'globals';

import baseConfig from './base.js';

export default [
  ...baseConfig,
  {
    files: ['**/*.{ts,mts,cts,js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-process-env': 'off',
    },
  },
];
