// eslint-disable-next-line no-undef
module.exports = {
  extends: [
    'airbnb',
    'airbnb/hooks',
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'prettier',
  ],
  plugins: ['@typescript-eslint', 'simple-import-sort', 'prettier'],
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'no-shadow': 'off',
    'no-unused-vars': 'off',
    'lines-between-class-members': 'off',
    'import/no-cycle': 'off',
    'import/named': 'off',
    'import/no-named-as-default': 'off',
    // REVIEW: enable
    'import/no-extraneous-dependencies': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/no-import-module-exports': 'off',
    '@typescript-eslint/no-shadow': 'error',
    '@typescript-eslint/no-unused-vars': 'error',
    'simple-import-sort/exports': 'warn',
    'simple-import-sort/imports': 'warn',
    'react/jsx-filename-extension': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    'react/require-default-props': 'off',
    'react/jsx-props-no-spreading': 'warn',
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: {
    browser: true,
    amd: true,
    node: true,
  },
  settings: {
    react: {
      version: 'detect',
    },
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {},
      typescript: {},
      webpack: {
        config: require.resolve('./.oplc/configs/webpack.config.eslint.ts'),
      },
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
