// Reglas: errores reales (variables sin declarar o sin usar, promesas mal tratadas, hooks). Sin reglas de estilo.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const reglas = {
  ...js.configs.recommended.rules,
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-control-regex': 'off',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
};

export default [
  { ignores: ['**/dist/**', 'node_modules/**', 'web/node_modules/**', 'backups/**', 'output/**', 'private/**', '.agents/**', '.claude/**'] },
  { files: ['src/**/*.js'], languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } }, rules: reglas },
  { files: ['tests/**/*.cjs', 'scripts/**/*.cjs'], languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } }, rules: { ...reglas, 'no-unused-vars': 'off', 'prefer-const': 'off' } },
  {
    files: ['web/src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser }, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { ...reglas, 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
];
