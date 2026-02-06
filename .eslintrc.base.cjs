/** @type {import('eslint').Linter.Config} */

const prettierConfigs = require('./.prettierrc.base.cjs')

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
  },
}
