// eslint-disable-next-line import/no-extraneous-dependencies
const { verify } = require('jsonwebtoken');
const { registerGameHandlers } = require('./gameManager');

const secret = process.env.JWT_SECRET || 'secret';

// eslint-disable-next-line jsdoc/require-jsdoc
function initSocket(io) {
  io.use((socket, next) => {
    const { token } = socket.handshake.auth;
    if (!token) return next(new Error('No token'));

    try {
      const payload = verify(token, secret);
      // eslint-disable-next-line no-param-reassign
      socket.user = payload;
      return next();
    } catch {
      return next(new Error('Invalid token'));
    }
  });

  io.engine.on('connection_error', (err) => {
    // eslint-disable-next-line no-console
    console.log('Engine.IO connection error:', err.code, err.message, err.context);
  });

  io.on('connection', (socket) => {
    // eslint-disable-next-line no-console
    console.log(`Socket connected: user ${socket.user.id} (${socket.user.name})`);

    registerGameHandlers(io, socket);
  });
}

module.exports = { initSocket };
