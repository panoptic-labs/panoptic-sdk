/** @type {import('eslint').Linter.Config} */

module.exports = {
  extends: ['./.eslintrc.base.cjs'],
  overrides: [
    {
      files: ['src/panoptic/v2/**/*.ts', 'src/panoptic/v2/**/*.tsx'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
  ],
}
