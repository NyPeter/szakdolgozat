/* eslint-disable jsdoc/require-jsdoc */
const db = require('../models');

const { User, Chat } = db;

function registerChatHandlers(io, socket) {
  socket.on('chat:send', async ({ message }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });

      const trimmed = message?.trim();
      if (!trimmed || trimmed.length > 500) return callback({ error: 'Invalid message.' });

      const sender = await User.findByPk(socket.user.id, { attributes: ['mutedUntil', 'name', 'avatarURL'] });
      if (sender?.mutedUntil && new Date(sender.mutedUntil) > new Date()) {
        return callback({ error: 'Le vagy némítva.' });
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
      return callback({ error: err.message });
    }
  });
}

module.exports = { registerChatHandlers };
