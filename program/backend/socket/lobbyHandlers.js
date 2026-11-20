/* eslint-disable object-curly-newline */
/* eslint-disable jsdoc/require-jsdoc */
const db = require('../models');

const {
  Game, GameUser, User, Chat,
} = db;

const {
  roomSettings, gameStates, gameRoundData, getRoomSettings, emitGameState,
} = require('./store');

const { initGameState, getPlayerView } = require('./gameEngine');
const { startTurnTimer } = require('./gameHandlers');
const msg = require('../utils/messages');
const { serverError } = require('../utils/serverError');

async function getGameState(gameId) {
  const game = await Game.findByPk(gameId, {
    include: [
      { model: User, as: 'Owner', attributes: ['id', 'name'] },
      { model: User, as: 'Players', attributes: ['id', 'name', 'avatarURL'], through: { attributes: [] } },
    ],
  });
  if (!game) return null;

  const chatHistory = await Chat.findAll({
    where: { gameID: gameId },
    include: [{ model: User, attributes: ['id', 'name', 'avatarURL'] }],
    order: [['createdAt', 'ASC']],
    limit: 100,
  });

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

async function handleLeave(io, socket) {
  const { gameRoomId } = socket;
  if (!gameRoomId) return;

  const game = await Game.findByPk(gameRoomId);
  if (!game) {
    socket.leave(`game:${gameRoomId}`);
    socket.gameRoomId = null;
    return;
  }

  if (game.status !== 'waiting') {
    // Started: keep GameUser so the player can rejoin.
    // Finished: keep everything, the result is the leaderboard's data.
    socket.leave(`game:${gameRoomId}`);
    socket.gameRoomId = null;
    return;
  }

  // Waiting room: fully remove the player
  await GameUser.destroy({ where: { gameID: gameRoomId, userID: socket.user.id } });
  socket.leave(`game:${gameRoomId}`);
  socket.gameRoomId = null;

  const updatedGame = await Game.findByPk(gameRoomId, {
    include: [{ model: User, as: 'Players', attributes: ['id'], through: { attributes: [] } }],
  });

  if (!updatedGame) return;

  if (updatedGame.Players.length === 0) {
    await updatedGame.destroy();
    roomSettings.delete(gameRoomId);
    return;
  }

  if (updatedGame.ownerID === socket.user.id) {
    const newOwnerId = updatedGame.Players[0]?.id;
    if (newOwnerId) await updatedGame.update({ ownerID: newOwnerId });
  }

  const state = await getGameState(gameRoomId);
  io.to(`game:${gameRoomId}`).emit('game:update', state);
}

// Tracks user IDs currently inside game:create to prevent duplicate rooms
// when the client fires multiple requests before the first one completes.
const creatingUsers = new Set();

function registerLobbyHandlers(io, socket) {
  socket.on('game:create', async (_, callback) => {
    if (creatingUsers.has(socket.user.id)) {
      return callback({ error: msg.ROOM_CREATE_IN_PROGRESS });
    }
    creatingUsers.add(socket.user.id);
    try {
      await handleLeave(io, socket);

      // Block creating a room while in an active game
      const activeGU = await GameUser.findOne({
        where: { userID: socket.user.id, isSurrendered: false },
        include: [{ model: Game, where: { status: 'started' }, required: true }],
      });
      if (activeGU) {
        return callback({ error: msg.ACTIVE_GAME });
      }

      const existing = await Game.findOne({
        where: { status: 'waiting', ownerID: socket.user.id },
      });
      if (existing) {
        return callback({ error: msg.ROOM_ALREADY_OPEN });
      }

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

      // Already tracked on this socket — re-emit state, skip all DB writes
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
        // Rejoin: only allowed if the player has a non-surrendered GameUser record
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

      // Block joining a waiting room while in an active (started) game
      const activeGU = await GameUser.findOne({
        where: { userID: socket.user.id, isSurrendered: false },
        include: [{ model: Game, where: { status: 'started' }, required: true }],
      });
      if (activeGU && activeGU.gameID !== gameId) {
        return callback({ error: msg.ACTIVE_GAME });
      }

      // Waiting room join — leave current room first
      if (socket.gameRoomId && socket.gameRoomId !== gameId) {
        await handleLeave(io, socket);
      }

      if (settings.password && settings.password !== password) {
        return callback({ error: msg.WRONG_PASSWORD, needsPassword: true });
      }
      if (game.Players.length >= settings.maxPlayers) {
        return callback({ error: msg.ROOM_FULL });
      }

      const [, created] = await GameUser.findOrCreate({
        where: { gameID: gameId, userID: socket.user.id },
      });

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

      const sockets = await io.in(`game:${gameRoomId}`).fetchSockets();
      const kicked = sockets.find((s) => String(s.user.id) === String(targetUserId));
      if (kicked) {
        kicked.emit('game:kicked');
        kicked.leave(`game:${gameRoomId}`);
        kicked.gameRoomId = null;
      }

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

  socket.on('disconnect', async () => {
    if (socket.gameRoomId) {
      try {
        await handleLeave(io, socket);
      } catch {
        // ignore cleanup errors on disconnect
      }
    }
  });
}

module.exports = { registerLobbyHandlers, handleLeave, getGameState };
