module.exports = {
  extends: [
    'eslint:recommended',
    'airbnb-base',
    'plugin:jsdoc/recommended',
  ],
  plugins: ['import'],
  parser: '@babel/eslint-parser',
  parserOptions: {
    requireConfigFile: false,
  },
  env: {
    browser: false,
    node: true,
    jest: true,
  },
  rules: {
    'jsdoc/tag-lines': [
      'warn',
      'any',
      {
        startLines: 1,
      },
    ],
    'no-plusplus': 'off',
  },
};
