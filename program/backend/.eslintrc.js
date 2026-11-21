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
    // Airbnb's list, plus Socket.IO sockets: per-connection data is stored on
    // the socket itself (socket.user, socket.gameRoomId), which is the intended use.
    'no-param-reassign': ['error', {
      props: true,
      ignorePropertyModificationsFor: [
        'acc', 'accumulator', 'e', 'ctx', 'context', 'req', 'request', 'res', 'response',
        '$scope', 'staticContext',
        'socket', 'tabSocket', 'kickedSocket',
      ],
    }],
  },
};
