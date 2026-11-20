/* eslint-disable jsdoc/require-jsdoc */
const db = require('../models');

const { User, Chat } = db;
const msg = require('../utils/messages');
const { serverError } = require('../utils/serverError');

function registerChatHandlers(io, socket) {
  socket.on('chat:send', async ({ message }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });

      const trimmed = message?.trim();
      if (!trimmed || trimmed.length > 500) return callback({ error: msg.INVALID_CHAT_MESSAGE });

      const sender = await User.findByPk(socket.user.id, { attributes: ['mutedUntil', 'name', 'avatarURL'] });
      if (sender?.mutedUntil && new Date(sender.mutedUntil) > new Date()) {
        return callback({ error: msg.MUTED });
      }

      const chat = await Chat.create({
        message: trimmed,
        userID: socket.user.id,
        gameID: gameRoomId,
      });

      io.to(`game:${gameRoomId}`).emit('chat:message', {
        id: chat.id,
        message: chat.message,
        user: { id: socket.user.id, name: sender.name, avatarURL: sender.avatarURL },
        createdAt: chat.createdAt,
      });

      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });
}

module.exports = { registerChatHandlers };
