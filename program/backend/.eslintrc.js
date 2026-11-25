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
  ignorePatterns: ['coverage'],
  rules: {
    // The server's console output is its log (startup, connections, errors).
    'no-console': 'off',
    // Airbnb also bans for...of, because it needed regenerator-runtime in old
    // browsers; Node runs it natively. for...in, labels and with stay banned.
    'no-restricted-syntax': ['error',
      { selector: 'ForInStatement', message: 'Use Object.keys/values/entries instead of for...in.' },
      { selector: 'LabeledStatement', message: 'Labels are a form of GOTO.' },
      { selector: 'WithStatement', message: '`with` is not allowed in strict mode.' },
    ],
    // Function declarations are hoisted, so calling one defined further down is safe.
    'no-use-before-define': ['error', { functions: false, classes: true, variables: true }],
    // Short objects such as cards ({ id, suit, rank, value }) may stay on one line;
    // the braces only have to be consistent.
    'object-curly-newline': ['error', { consistent: true }],
    'jsdoc/tag-lines': [
      'warn',
      'any',
      {
        startLines: 1,
      },
    ],
    'no-plusplus': 'off',
    // Airbnb's list, plus Socket.IO sockets: per-connection data is stored on
    // the socket itself (socket.user, socket.gameRoomId), which is the intended use.
    // gs: the game state is changed in place on purpose (gameStates holds it).
    'no-param-reassign': ['error', {
      props: true,
      ignorePropertyModificationsFor: [
        'acc', 'accumulator', 'e', 'ctx', 'context', 'req', 'request', 'res', 'response',
        '$scope', 'staticContext',
        'socket', 'tabSocket', 'kickedSocket', 'gs',
      ],
    }],
  },
  overrides: [
    {
      // The seeder only runs in development (npm run db), so faker is a devDependency.
      files: ['seeders/**'],
      rules: { 'import/no-extraneous-dependencies': ['error', { devDependencies: true }] },
    },
  ],
};
