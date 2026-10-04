/** @type {import('eslint').Linter.Config} */

const prettierConfigs = require('./.prettierrc.base.cjs')

// RPC vendor URLs belong only in the SDK provider registry, so switching or
// adding a provider stays an env change (see docs/rpc.md).
const RPC_PROVIDER_HOSTS = '/alchemy\\.com|infura\\.io|uniblock\\.dev|quiknode/'
const RPC_PROVIDER_MESSAGE =
  'Do not build RPC provider URLs here; resolve endpoints with @panoptic-eng/sdk/rpc (see docs/rpc.md).'

module.exports = {
  extends: [
    '@remix-run/eslint-config',
    '@remix-run/eslint-config/node',
    'plugin:@tanstack/query/recommended',
    'plugin:prettier/recommended',
  ],
  env: {
    es2020: true, // <- activate “es2020” globals
  },
  plugins: ['simple-import-sort', 'react-hooks'],
  rules: {
    '@typescript-eslint/no-non-null-assertion': 'error',
    // Overwrite default Prettier settings - https://prettier.io/docs/en/options.html
    'prettier/prettier': ['error', prettierConfigs],
    'no-console': ['error', { allow: ['debug', 'warn', 'error'] }],
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'react-hooks/rules-of-hooks': 'warn',
    '@typescript-eslint/no-unused-vars': 'warn',
    'react-hooks/exhaustive-deps': 'warn',
    'no-restricted-syntax': [
      'error',
      { selector: `Literal[value=${RPC_PROVIDER_HOSTS}]`, message: RPC_PROVIDER_MESSAGE },
      { selector: `TemplateElement[value.raw=${RPC_PROVIDER_HOSTS}]`, message: RPC_PROVIDER_MESSAGE },
    ],
  },
  overrides: [
    {
      files: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
      ],
      rules: { 'no-restricted-syntax': 'off' },
    },
  ],
}
