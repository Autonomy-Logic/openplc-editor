/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import eslint from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import reactRecommended from 'eslint-plugin-react/configs/recommended.js'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** @type {import('@types/eslint').Linter.FlatConfig} */
export default [
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    rules: {
      '@typescript-eslint/no-floating-promises': ['warn', { ignoreIIFE: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          vars: 'all',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ...reactRecommended,
    name: 'eslint-plugin-react',
    files: ['**/*.{js,jsx,ts,tsx}'],
    ignores: ['src/main/**/*'],
    languageOptions: {
      parserOptions: {
        project: true,
        ecmaFeatures: {
          jsx: true,
        },
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.amd,
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.node,
      },
    },
    rules: {
      'require-render-return': 'off',
      'jsx-filename-extension': 'off',
      'react-in-jsx-scope': 'off',
      'prop-types': 'off',
      'require-default-props': 'off',
      'jsx-props-no-spreading': 'off',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    name: 'simple-import-sort',
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.amd,
        ...globals.browser,
        ...globals.serviceworker,
        ...globals.node,
      },
    },
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/exports': 'error',
      'simple-import-sort/imports': 'error',
    },
  },
  eslintConfigPrettier,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      '**/*.d.ts',
      '**/*.test.{js,jsx,ts,tsx}',
      '**/*.spec.{js,jsx,ts,tsx}',
      '**/*.config.{js,ts,mjs,cjs}',
      'configs/dll/**/*.{js,ts,jsx,tsx}',
    ],
  },
]
