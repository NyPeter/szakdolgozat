/* eslint-disable jsdoc/require-jsdoc */
const { getPlayerView } = require('./gameEngine');

// In-memory settings for waiting rooms: gameId -> { maxPlayers, password }
const roomSettings = new Map();
// Active game states: gameId -> gameState object from initGameState
const gameStates = new Map();
// Per-game round tracking: gameId -> { playerIds, round, scores, roundHistory,
//   surrenderedPlayers, consecutiveTimeouts }
const gameRoundData = new Map();
// Active turn timers: gameId -> NodeJS.Timeout
const turnTimers = new Map();

function getRoomSettings(gameId) {
  return roomSettings.get(gameId) ?? { maxPlayers: 6, password: null };
}

function clearTurnTimer(gameId) {
  const t = turnTimers.get(gameId);
  if (t) { clearTimeout(t); turnTimers.delete(gameId); }
}

async function emitGameState(io, gameId, gs) {
  const rd = gameRoundData.get(gameId);
  const sockets = await io.in(`game:${gameId}`).fetchSockets();
  sockets.forEach((s) => {
    const view = getPlayerView(gs, s.user.id);
    if (rd) {
      view.scores = rd.scores;
      view.surrenderedPlayers = rd.surrenderedPlayers ?? [];
    }
    s.emit('game:state', view);
  });
}

module.exports = {
  roomSettings,
  gameStates,
  gameRoundData,
  turnTimers,
  getRoomSettings,
  clearTurnTimer,
  emitGameState,
};
