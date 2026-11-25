const { verify } = require('jsonwebtoken');
const { registerGameHandlers } = require('./gameManager');
const msg = require('../utils/messages');
const { loadCurrentUser } = require('../utils/currentUser');

const secret = process.env.JWT_SECRET || 'secret';

/**
 * Sets up the Socket.IO server: token check on connect, then the event handlers.
 *
 * @param {object} io - Socket.IO server.
 */
function initSocket(io) {
  io.use(async (socket, next) => {
    const { token } = socket.handshake.auth;
    if (!token) return next(new Error(msg.UNAUTHORIZED));

    let payload;
    try {
      payload = verify(token, secret);
    } catch {
      return next(new Error(msg.UNAUTHORIZED));
    }

    // Same check as the REST routes: the account must still exist and not be suspended.
    try {
      const { user, message } = await loadCurrentUser(payload.id);
      if (!user) return next(new Error(message));
      socket.user = { id: user.id, name: user.name };
      return next();
    } catch (err) {
      console.error(err);
      return next(new Error(msg.SERVER_ERROR));
    }
  });

  io.engine.on('connection_error', (err) => {
    console.log('Engine.IO connection error:', err.code, err.message, err.context);
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: user ${socket.user.id} (${socket.user.name})`);

    registerGameHandlers(io, socket);
  });
}

module.exports = { initSocket };
