import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactRefreshPlugin from 'eslint-plugin-react-refresh';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import sortKeysFixPlugin from 'eslint-plugin-sort-keys-fix';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'build/**',
      '**/*.yml',
      '**/*.d.ts',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
      'eslint.config.js',
      'vite.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2020,
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly',
      },
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-refresh': reactRefreshPlugin,
      prettier: prettierPlugin,
      import: importPlugin,
      'simple-import-sort': simpleImportSortPlugin,
      'sort-keys-fix': sortKeysFixPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React Refresh
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // Basic rules
      quotes: ['error', 'single', 'avoid-escape'],
      'no-empty-function': 'off',
      'no-console': [
        'error',
        {
          allow: ['error', 'warn'],
        },
      ],
      'no-debugger': 'error',
      'no-multiple-empty-lines': [
        'error',
        {
          max: 1,
          maxEOF: 0,
          maxBOF: 0,
        },
      ],
      'no-unreachable': 'warn',
      'no-case-declarations': 'warn',
      'space-before-function-paren': 'off',
      'no-return-assign': 'warn',
      'guard-for-in': 'error',
      'spaced-comment': ['warn', 'always'],
      'valid-typeof': 'error',
      'no-use-before-define': 'off',

      // Prettier
      'prettier/prettier': 'error',

      // TypeScript rules
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '_', argsIgnorePattern: '_' },
      ],
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',

      // React rules
      'react/no-unsafe': 'off',
      'react/self-closing-comp': [
        'warn',
        {
          component: true,
          html: true,
        },
      ],
      'react/prop-types': 'off',
      'react/display-name': 'off',
      'react/no-children-prop': 'error',
      'react/no-deprecated': 'error',
      'react/no-direct-mutation-state': 'warn',
      'react/no-is-mounted': 'warn',
      'react/boolean-prop-naming': [
        'error',
        {
          rule: '^(is|has|show)[A-Z]([A-Za-z0-9]?)+',
        },
      ],
      'react/react-in-jsx-scope': 'off',
      'react/require-render-return': 'error',
      'react/jsx-closing-tag-location': 'warn',
      'react/jsx-equals-spacing': 'warn',
      'react/jsx-wrap-multilines': 'warn',
      'react/jsx-no-comment-textnodes': 'warn',
      'react/jsx-no-undef': 'error',
      'react/jsx-no-useless-fragment': 'warn',
      'react/jsx-pascal-case': 'error',
      'react/jsx-tag-spacing': 'warn',
      'react/jsx-uses-react': 'error',
      'react/jsx-no-duplicate-props': 'warn',
      'react/no-unknown-property': 'off',

      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Import sorting
      'simple-import-sort/imports': 'error',
      'import/newline-after-import': [
        'error',
        {
          count: 1,
        },
      ],

      // Sort keys
      'sort-keys-fix/sort-keys-fix': 'warn',
    },
  },
  prettierConfig,
);
