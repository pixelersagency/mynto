import baseConfig from '@mynto/eslint-config/base';

export default [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'coverage/**',
      'next-env.d.ts',
      'tina/**',
      'public/admin/**',
    ],
  },
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    // Scripts Node lancés hors bundler : ils ont droit à `process` et à la
    // console, contrairement au code applicatif.
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
