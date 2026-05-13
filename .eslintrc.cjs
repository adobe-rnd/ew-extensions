module.exports = {
  root: true,
  extends: ['@adobe/helix'],
  env: {
    browser: true,
    es6: true,
  },
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 'latest',
  },
  rules: {
    'import/prefer-default-export': 'off',
    'no-underscore-dangle': 'off',
    'header/header': 'off',
    'class-methods-use-this': 'off',
    'no-param-reassign': 'off',
    'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
    'import/extensions': ['error', 'always', { ignorePackages: true }],
    'import/no-unresolved': 'off',
    'no-restricted-globals': 'off',
    'max-statements-per-line': 'off',
    'object-curly-newline': 'off',
    indent: 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'max-len': ['warn', { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }],
    'no-continue': 'off',
  },
};
