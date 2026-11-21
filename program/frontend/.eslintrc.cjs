module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'airbnb-base',
    'plugin:react/recommended',
    'plugin:react/jsx-runtime',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  settings: {
    react: { version: '18.2' },
    'import/resolver': {
      node: { extensions: ['.js', '.jsx'] },
    },
  },
  plugins: ['react-refresh'],
  rules: {
    'react/jsx-no-target-blank': 'off',
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // The components take plain props; the project does not use PropTypes.
    'react/prop-types': 'off',
    // Views are named exports (export function Login), which is intentional.
    'import/prefer-default-export': 'off',
    // Failed requests are logged for debugging; console.log is still reported.
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      // Build-time config: its imports are devDependencies on purpose.
      files: ['vite.config.js'],
      rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
    },
  ],
}
