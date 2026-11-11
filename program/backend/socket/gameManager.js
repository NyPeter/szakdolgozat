/* eslint-disable jsdoc/require-jsdoc */
const { registerLobbyHandlers } = require('./lobbyHandlers');
const { registerChatHandlers } = require('./chatHandlers');
const { registerInGameHandlers } = require('./gameHandlers');
const { getRoomSettings } = require('./store');

function registerGameHandlers(io, socket) {
  registerLobbyHandlers(io, socket);
  registerChatHandlers(io, socket);
  registerInGameHandlers(io, socket);
}

// getRoomSettings is re-exported for routes/game.js
module.exports = { registerGameHandlers, getRoomSettings };
