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

  if (game.status === 'started') {
    // Disconnect from the socket room but keep GameUser — allows rejoin
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
      return callback({ error: 'Már folyamatban van a szoba létrehozása.' });
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
        return callback({ error: 'Már van egy aktív játékod. Előbb fejezd be vagy add fel.' });
      }

      const existing = await Game.findOne({
        where: { status: 'waiting', ownerID: socket.user.id },
      });
      if (existing) {
        return callback({ error: 'You already have an open room.' });
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
      return callback({ error: err.message });
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
        return callback({ error: 'Room not found.' });
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
          return callback({ error: 'A játék már elindult.' });
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
        return callback({ error: 'Már van egy aktív játékod. Előbb fejezd be vagy add fel.' });
      }

      // Waiting room join — leave current room first
      if (socket.gameRoomId && socket.gameRoomId !== gameId) {
        await handleLeave(io, socket);
      }

      if (settings.password && settings.password !== password) {
        return callback({ error: 'Wrong password.' });
      }
      if (game.Players.length >= settings.maxPlayers) {
        return callback({ error: 'Room is full.' });
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
      return callback({ error: err.message });
    }
  });

  socket.on('game:leave', async (_, callback) => {
    try {
      await handleLeave(io, socket);
      return callback({ ok: true });
    } catch (err) {
      return callback({ error: err.message });
    }
  });

  socket.on('game:settings', async ({ maxPlayers, password }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });

      const game = await Game.findByPk(gameRoomId);
      if (!game) return callback({ error: 'Room not found.' });
      if (game.ownerID !== socket.user.id) return callback({ error: 'Only the owner can change settings.' });
      if (game.status !== 'waiting') return callback({ error: 'Cannot change settings after game started.' });

      const clamped = Math.min(6, Math.max(2, Number(maxPlayers) || 6));
      const currentPlayers = await GameUser.count({ where: { gameID: gameRoomId } });
      if (clamped < currentPlayers) {
        return callback({ error: `Cannot set max lower than current player count (${currentPlayers}).` });
      }

      roomSettings.set(gameRoomId, {
        maxPlayers: clamped,
        password: password || null,
      });

      const state = await getGameState(gameRoomId);
      io.to(`game:${gameRoomId}`).emit('game:update', state);
      return callback({ ok: true });
    } catch (err) {
      return callback({ error: err.message });
    }
  });

  socket.on('game:kick', async ({ targetUserId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });

      const game = await Game.findByPk(gameRoomId);
      if (!game) return callback({ error: 'Room not found.' });
      if (game.ownerID !== socket.user.id) return callback({ error: 'Only the owner can kick.' });
      if (game.status !== 'waiting') return callback({ error: 'Game already started.' });
      if (String(targetUserId) === String(socket.user.id)) return callback({ error: 'Cannot kick yourself.' });

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
      return callback({ error: err.message });
    }
  });

  socket.on('game:start', async (_, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });

      const game = await Game.findByPk(gameRoomId, {
        include: [{ model: User, as: 'Players', attributes: ['id'], through: { attributes: [] } }],
      });

      if (!game) return callback({ error: 'Room not found.' });
      if (game.ownerID !== socket.user.id) return callback({ error: 'Only the owner can start.' });
      if (game.Players.length < 2) return callback({ error: 'Need at least 2 players.' });

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
      return callback({ error: err.message });
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
