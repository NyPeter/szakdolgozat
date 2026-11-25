const db = require('../models');

const {
  Game, GameUser, User, Chat,
} = db;

const {
  roomSettings, gameStates, gameRoundData, leaveTimers, getRoomSettings, emitGameState,
} = require('./store');

const { initGameState } = require('./gameEngine');
const { startTurnTimer } = require('./gameHandlers');
const msg = require('../utils/messages');
const { serverError } = require('../utils/serverError');

const CHAT_HISTORY_LIMIT = 1000;

/**
 * The room as the clients show it: owner, players, settings and chat history.
 *
 * @param {number} gameId - Room id.
 * @returns {Promise<object|null>} The room, or null when it does not exist.
 */
async function getGameState(gameId) {
  const game = await Game.findByPk(gameId, {
    include: [
      { model: User, as: 'Owner', attributes: ['id', 'name'] },
      { model: User, as: 'Players', attributes: ['id', 'name', 'avatarURL'], through: { attributes: [] } },
    ],
  });
  if (!game) return null;

  // The latest CHAT_HISTORY_LIMIT messages: fetched newest first so the limit
  // cuts off the old ones, then reversed to show them in chronological order.
  const chatHistory = (await Chat.findAll({
    where: { gameID: gameId },
    include: [{ model: User, attributes: ['id', 'name', 'avatarURL'] }],
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: CHAT_HISTORY_LIMIT,
  })).reverse();

  const settings = getRoomSettings(gameId);
  return {
    id: game.id,
    status: game.status,
    owner: game.Owner,
    players: game.Players,
    maxPlayers: settings.maxPlayers,
    hasPassword: !!settings.password,
    messages: chatHistory.map((m) => ({
      id: m.id,
      message: m.message,
      user: m.User,
      createdAt: m.createdAt,
    })),
  };
}

// How long a disconnected player keeps their waiting-room seat (page reload).
// The tests shorten it with LEAVE_GRACE_MS so they do not wait 10 s each time.
const LEAVE_GRACE_MS = Number(process.env.LEAVE_GRACE_MS) || 10 * 1000;

const leaveKey = (gameId, userId) => `${gameId}:${userId}`;

/**
 * @param {number} gameId - Room id.
 * @param {number|string} userId - The player whose kept seat no longer needs a timer.
 */
function cancelLeaveTimer(gameId, userId) {
  const key = leaveKey(gameId, userId);
  const timer = leaveTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    leaveTimers.delete(key);
  }
}

/**
 * Removes a player from a waiting room: the room goes to the next player, or is
 * deleted when nobody is left. The player's other tabs showing this room are sent
 * 'game:left'. Started and finished games are not touched (the seat is kept for
 * rejoining, and a finished game is the leaderboard's data).
 *
 * @param {object} io - Socket.IO server.
 * @param {number} gameId - Room id.
 * @param {number|string} userId - The leaving player.
 * @returns {Promise<void>}
 */
async function removeFromWaitingRoom(io, gameId, userId) {
  cancelLeaveTimer(gameId, userId);

  const game = await Game.findByPk(gameId);
  if (!game || game.status !== 'waiting') return;

  await GameUser.destroy({ where: { gameID: gameId, userID: userId } });

  const sockets = await io.in(`game:${gameId}`).fetchSockets();
  sockets
    .filter((s) => String(s.user.id) === String(userId))
    .forEach((tabSocket) => {
      tabSocket.emit('game:left');
      tabSocket.leave(`game:${gameId}`);
      tabSocket.gameRoomId = null;
    });

  const updatedGame = await Game.findByPk(gameId, {
    include: [{ model: User, as: 'Players', attributes: ['id'], through: { attributes: [] } }],
  });
  if (!updatedGame) return; // removed meanwhile by another leave

  if (updatedGame.Players.length === 0) {
    await updatedGame.destroy();
    roomSettings.delete(gameId);
    return;
  }

  if (String(updatedGame.ownerID) === String(userId)) {
    await updatedGame.update({ ownerID: updatedGame.Players[0].id });
  }

  const state = await getGameState(gameId);
  io.to(`game:${gameId}`).emit('game:update', state);
}

/**
 * This tab leaves its room ("Kilépés", or joining/creating another room).
 *
 * @param {object} io - Socket.IO server.
 * @param {object} socket - The tab's socket.
 * @returns {Promise<void>}
 */
async function handleLeave(io, socket) {
  const { gameRoomId } = socket;
  if (!gameRoomId) return;

  socket.leave(`game:${gameRoomId}`);
  socket.gameRoomId = null;
  await removeFromWaitingRoom(io, gameRoomId, socket.user.id);
}

/**
 * One room per user: removes the user from every waiting room they have a seat in,
 * except `exceptGameId`. Based on the database, so seats held by other tabs or by
 * a pending leave timer are found too.
 *
 * @param {object} io - Socket.IO server.
 * @param {number} userId - The user.
 * @param {number|null} [exceptGameId] - A room to stay in.
 * @returns {Promise<void>}
 */
async function leaveWaitingRooms(io, userId, exceptGameId = null) {
  const seats = await GameUser.findAll({
    where: { userID: userId },
    include: [{ model: Game, where: { status: 'waiting' }, required: true }],
  });
  for (const seat of seats) {
    // String(): the id from the client is not guaranteed to be a number
    if (String(seat.gameID) !== String(exceptGameId)) {
      // eslint-disable-next-line no-await-in-loop -- one room at a time, in order
      await removeFromWaitingRoom(io, seat.gameID, userId);
    }
  }
}

/**
 * A tab in a room was closed or reloaded. The seat is kept for LEAVE_GRACE_MS,
 * and counts as taken for everything meanwhile; then the player is removed
 * unless one of their tabs is in the room again.
 *
 * @param {object} io - Socket.IO server.
 * @param {number} gameId - Room id.
 * @param {number} userId - The disconnected player.
 */
function scheduleLeave(io, gameId, userId) {
  cancelLeaveTimer(gameId, userId);
  const timer = setTimeout(async () => {
    leaveTimers.delete(leaveKey(gameId, userId));
    try {
      const sockets = await io.in(`game:${gameId}`).fetchSockets();
      if (sockets.some((s) => String(s.user.id) === String(userId))) return;
      await removeFromWaitingRoom(io, gameId, userId);
    } catch (err) {
      console.error(err);
    }
  }, LEAVE_GRACE_MS);
  leaveTimers.set(leaveKey(gameId, userId), timer);
}

// Tracks user IDs currently inside game:create to prevent duplicate rooms
// when the client fires multiple requests before the first one completes.
const creatingUsers = new Set();

/**
 * Registers the room events: create, join, leave, settings, kick, start, disconnect.
 *
 * @param {object} io - Socket.IO server.
 * @param {object} socket - The connected socket.
 */
function registerLobbyHandlers(io, socket) {
  socket.on('game:create', async (_, callback) => {
    if (creatingUsers.has(socket.user.id)) {
      return callback({ error: msg.ROOM_CREATE_IN_PROGRESS });
    }
    creatingUsers.add(socket.user.id);
    try {
      const activeGU = await GameUser.findOne({
        where: { userID: socket.user.id, isSurrendered: false },
        include: [{ model: Game, where: { status: 'started' }, required: true }],
      });
      if (activeGU) {
        return callback({ error: msg.ACTIVE_GAME });
      }

      // One room per user: creating a room leaves the previous one
      // (this tab's, and any other tab's or reloaded page's seat).
      await handleLeave(io, socket);
      await leaveWaitingRooms(io, socket.user.id);

      const game = await Game.create({ status: 'waiting', ownerID: socket.user.id });
      await GameUser.create({ gameID: game.id, userID: socket.user.id });

      roomSettings.set(game.id, { maxPlayers: 6, password: null });

      socket.gameRoomId = game.id;
      socket.join(`game:${game.id}`);

      const state = await getGameState(game.id);
      socket.emit('game:joined', state);

      return callback({ ok: true, gameId: game.id });
    } catch (err) {
      return callback(serverError(err));
    } finally {
      creatingUsers.delete(socket.user.id);
    }
  });

  // Three cases: this tab is already in the room; the game has started (only
  // its players may come back); a waiting room (password and free place,
  // unless the user still has a seat there).
  socket.on('game:join', async ({ gameId, password }, callback) => {
    try {
      const game = await Game.findByPk(gameId, {
        include: [{ model: User, as: 'Players', attributes: ['id'], through: { attributes: [] } }],
      });

      if (!game) {
        return callback({ error: msg.ROOM_NOT_FOUND });
      }
      if (game.status === 'finished') {
        return callback({ error: msg.GAME_FINISHED });
      }

      // The page asked again (reconnect, remount): only resend the state.
      if (socket.gameRoomId === gameId) {
        const state = await getGameState(gameId);
        socket.emit('game:joined', state);
        if (game.status === 'started') {
          const gs = gameStates.get(gameId);
          if (gs) await emitGameState(io, gameId, gs);
        }
        return callback({ ok: true });
      }

      const settings = getRoomSettings(gameId);

      if (game.status === 'started') {
        const existing = await GameUser.findOne({
          where: { gameID: gameId, userID: socket.user.id, isSurrendered: false },
        });
        if (!existing) {
          return callback({ error: msg.GAME_ALREADY_STARTED });
        }
        socket.gameRoomId = gameId;
        socket.join(`game:${gameId}`);
        const state = await getGameState(gameId);
        socket.emit('game:joined', state);
        io.to(`game:${gameId}`).emit('game:update', state);
        const gs = gameStates.get(gameId);
        if (gs) await emitGameState(io, gameId, gs);
        return callback({ ok: true });
      }

      const activeGU = await GameUser.findOne({
        where: { userID: socket.user.id, isSurrendered: false },
        include: [{ model: Game, where: { status: 'started' }, required: true }],
      });
      if (activeGU && activeGU.gameID !== gameId) {
        return callback({ error: msg.ACTIVE_GAME });
      }

      // Already a player here (page reload, second tab): this is a return, so no
      // password or "room full" check, the seat was never given up.
      const seat = await GameUser.findOne({ where: { gameID: gameId, userID: socket.user.id } });
      if (!seat) {
        if (settings.password && settings.password !== password) {
          return callback({ error: msg.WRONG_PASSWORD, needsPassword: true });
        }
        if (game.Players.length >= settings.maxPlayers) {
          return callback({ error: msg.ROOM_FULL });
        }
      }

      // One room per user: leave this tab's previous room and any other waiting
      // room (another tab's, or one kept for a reloaded page). After the checks,
      // so a failed join does not cost the current seat.
      await handleLeave(io, socket);
      await leaveWaitingRooms(io, socket.user.id, gameId);

      if (!seat) await GameUser.create({ gameID: gameId, userID: socket.user.id });
      cancelLeaveTimer(gameId, socket.user.id);
      const created = !seat;

      socket.gameRoomId = gameId;
      socket.join(`game:${gameId}`);

      const state = await getGameState(gameId);
      io.to(`game:${gameId}`).emit('game:update', state);
      socket.emit('game:joined', state);

      return callback({ ok: true, created });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  socket.on('game:leave', async (_, callback) => {
    try {
      await handleLeave(io, socket);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  socket.on('game:settings', async ({ maxPlayers, password }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });

      const game = await Game.findByPk(gameRoomId);
      if (!game) return callback({ error: msg.ROOM_NOT_FOUND });
      if (game.ownerID !== socket.user.id) return callback({ error: msg.OWNER_ONLY_SETTINGS });
      if (game.status !== 'waiting') return callback({ error: msg.GAME_ALREADY_STARTED });

      const clamped = Math.min(6, Math.max(2, Number(maxPlayers) || 6));
      const currentPlayers = await GameUser.count({ where: { gameID: gameRoomId } });
      if (clamped < currentPlayers) {
        return callback({ error: msg.MAX_PLAYERS_TOO_LOW(currentPlayers) });
      }

      roomSettings.set(gameRoomId, {
        maxPlayers: clamped,
        password: password || null,
      });

      const state = await getGameState(gameRoomId);
      io.to(`game:${gameRoomId}`).emit('game:update', state);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  socket.on('game:kick', async ({ targetUserId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });

      const game = await Game.findByPk(gameRoomId);
      if (!game) return callback({ error: msg.ROOM_NOT_FOUND });
      if (game.ownerID !== socket.user.id) return callback({ error: msg.OWNER_ONLY_KICK });
      if (game.status !== 'waiting') return callback({ error: msg.GAME_ALREADY_STARTED });
      if (String(targetUserId) === String(socket.user.id)) {
        return callback({ error: msg.CANNOT_KICK_SELF });
      }

      await GameUser.destroy({ where: { gameID: gameRoomId, userID: targetUserId } });
      cancelLeaveTimer(gameRoomId, targetUserId);

      const sockets = await io.in(`game:${gameRoomId}`).fetchSockets();
      sockets
        .filter((s) => String(s.user.id) === String(targetUserId))
        .forEach((kickedSocket) => {
          kickedSocket.emit('game:kicked');
          kickedSocket.leave(`game:${gameRoomId}`);
          kickedSocket.gameRoomId = null;
        });

      const state = await getGameState(gameRoomId);
      io.to(`game:${gameRoomId}`).emit('game:update', state);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  socket.on('game:start', async (_, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });

      const game = await Game.findByPk(gameRoomId, {
        include: [{ model: User, as: 'Players', attributes: ['id'], through: { attributes: [] } }],
      });

      if (!game) return callback({ error: msg.ROOM_NOT_FOUND });
      if (game.ownerID !== socket.user.id) return callback({ error: msg.OWNER_ONLY_START });
      if (game.status !== 'waiting') return callback({ error: msg.GAME_ALREADY_STARTED });
      if (game.Players.length < 2) return callback({ error: msg.NOT_ENOUGH_PLAYERS });

      await game.update({ status: 'started' });
      roomSettings.delete(game.id);

      const playerIds = game.Players.map((p) => p.id);
      gameRoundData.set(gameRoomId, {
        playerIds,
        round: 1,
        scores: Object.fromEntries(playerIds.map((id) => [String(id), 0])),
        roundHistory: [],
        surrenderedPlayers: [],
        consecutiveTimeouts: {},
      });
      const gs = initGameState(playerIds, 1);
      gameStates.set(gameRoomId, gs);

      io.to(`game:${gameRoomId}`).emit('game:started', { gameId: gameRoomId });
      startTurnTimer(io, gameRoomId);
      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // Closed or reloaded tab: not a leave yet, the seat is kept for a few seconds.
  socket.on('disconnect', () => {
    if (socket.gameRoomId) scheduleLeave(io, socket.gameRoomId, socket.user.id);
  });
}

module.exports = {
  registerLobbyHandlers, handleLeave, leaveWaitingRooms, getGameState,
};
