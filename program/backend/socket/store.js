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

// Copy of the game state taken at the start of the current turn: gameId -> gameState.
// Used to roll a turn back (undo of a face-up draw, timeout with a half-finished turn).
const turnSnapshots = new Map();

function clearTurnTimer(gameId) {
  const t = turnTimers.get(gameId);
  if (t) { clearTimeout(t); turnTimers.delete(gameId); }
}

function saveTurnSnapshot(gameId, gs) {
  turnSnapshots.set(gameId, structuredClone(gs));
}

// Puts the state back to how it was when the turn started. The object itself is
// kept (gameStates holds a reference to it), only its contents are replaced.
function restoreTurnSnapshot(gameId, gs) {
  const snapshot = turnSnapshots.get(gameId);
  if (!snapshot) return false;
  // eslint-disable-next-line no-param-reassign
  Object.keys(gs).forEach((key) => { delete gs[key]; });
  Object.assign(gs, structuredClone(snapshot));
  return true;
}

// Frees everything kept in memory for a game that has ended.
function clearGameMemory(gameId) {
  clearTurnTimer(gameId);
  gameStates.delete(gameId);
  gameRoundData.delete(gameId);
  turnSnapshots.delete(gameId);
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
  saveTurnSnapshot,
  restoreTurnSnapshot,
  clearGameMemory,
  emitGameState,
};
