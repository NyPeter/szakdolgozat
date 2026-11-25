const { registerLobbyHandlers } = require('./lobbyHandlers');
const { registerChatHandlers } = require('./chatHandlers');
const { registerInGameHandlers } = require('./gameHandlers');
const { getRoomSettings } = require('./store');

/**
 * Registers every event handler for one connected socket.
 *
 * @param {object} io - Socket.IO server.
 * @param {object} socket - The connected socket.
 */
function registerGameHandlers(io, socket) {
  registerLobbyHandlers(io, socket);
  registerChatHandlers(io, socket);
  registerInGameHandlers(io, socket);
}

// getRoomSettings is re-exported for routes/game.js
module.exports = { registerGameHandlers, getRoomSettings };
