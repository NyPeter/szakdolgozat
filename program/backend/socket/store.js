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
// Waiting-room seats of disconnected players, kept for a short time so that a
// page reload does not count as leaving: `${gameId}:${userId}` -> NodeJS.Timeout
const leaveTimers = new Map();

/**
 * Settings of a waiting room, or the defaults when none were saved.
 *
 * @param {number} gameId - Room id.
 * @returns {object} `{ maxPlayers, password }`.
 */
function getRoomSettings(gameId) {
  return roomSettings.get(gameId) ?? { maxPlayers: 6, password: null };
}

// Copy of the game state taken at the start of the current turn: gameId -> gameState.
// Used to roll a turn back (undo of a face-up draw, timeout with a half-finished turn).
const turnSnapshots = new Map();

/**
 * Stops the turn timer of a game, if it has one.
 *
 * @param {number} gameId - Game id.
 */
function clearTurnTimer(gameId) {
  const t = turnTimers.get(gameId);
  if (t) { clearTimeout(t); turnTimers.delete(gameId); }
}

/**
 * Saves a deep copy of the game state as the start of the current turn.
 *
 * @param {number} gameId - Game id.
 * @param {object} gs - Game state.
 */
function saveTurnSnapshot(gameId, gs) {
  turnSnapshots.set(gameId, structuredClone(gs));
}

/**
 * Puts the state back to how it was when the turn started. The object itself is
 * kept (gameStates holds a reference to it), only its contents are replaced.
 *
 * @param {number} gameId - Game id.
 * @param {object} gs - Game state to overwrite.
 * @returns {boolean} False when there is no snapshot.
 */
function restoreTurnSnapshot(gameId, gs) {
  const snapshot = turnSnapshots.get(gameId);
  if (!snapshot) return false;
  Object.keys(gs).forEach((key) => { delete gs[key]; });
  Object.assign(gs, structuredClone(snapshot));
  return true;
}

/**
 * Frees everything kept in memory for a game that has ended.
 *
 * @param {number} gameId - Game id.
 */
function clearGameMemory(gameId) {
  clearTurnTimer(gameId);
  gameStates.delete(gameId);
  gameRoundData.delete(gameId);
  turnSnapshots.delete(gameId);
}

/**
 * Sends every player in the room their own view of the game state
 * (own hand visible, the others' hands as card counts).
 *
 * @param {object} io - Socket.IO server.
 * @param {number} gameId - Game id.
 * @param {object} gs - Game state.
 * @returns {Promise<void>}
 */
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
  leaveTimers,
  getRoomSettings,
  clearTurnTimer,
  saveTurnSnapshot,
  restoreTurnSnapshot,
  clearGameMemory,
  emitGameState,
};
