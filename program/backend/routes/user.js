const fs = require('fs');
const db = require('../models');

const {
  User, Game, GameUser, Chat, sequelize,
} = db;
const { Op } = db.Sequelize;
const { describeUserError } = require('../utils/userErrors');
const msg = require('../utils/messages');
const { leaveWaitingRooms, getGameState } = require('../socket/lobbyHandlers');

module.exports = async (fastify) => {
  fastify.get('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    const user = await User.findByPk(request.user.id);
    reply.send({ user });
  });

  fastify.put('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    const { id } = request.user;
    const { email, name } = request.body;
    const user = await User.findByPk(id);
    if (!user) {
      return reply.status(404).send({ message: msg.USER_NOT_FOUND });
    }
    try {
      await user.update({
        name: name ?? user.name,
        email: email ?? user.email,
      });
      return reply.send(user);
    } catch (err) {
      const { status, message } = describeUserError(err);
      return reply.status(status).send({ message });
    }
  });

  fastify.put('/user/password', { onRequest: [fastify.auth] }, async (request, reply) => {
    const { id } = request.user;
    const { currentPassword, newPassword } = request.body;
    const user = await User.findByPk(id);
    if (!user) {
      return reply.status(404).send({ message: msg.USER_NOT_FOUND });
    }
    if (!currentPassword || !newPassword) {
      return reply.status(400).send({ message: msg.PASSWORDS_REQUIRED });
    }
    if (!user.comparePassword(currentPassword)) {
      return reply.status(401).send({ message: msg.WRONG_CURRENT_PASSWORD });
    }
    try {
      await user.update({ password: newPassword });
      return reply.send({ message: msg.PASSWORD_CHANGED });
    } catch (err) {
      const { status, message } = describeUserError(err);
      return reply.status(status).send({ message });
    }
  });

  fastify.delete('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    const { id } = request.user;
    const { password } = request.body ?? {};

    const user = await User.findByPk(id);
    if (!user) {
      return reply.status(404).send({ message: msg.USER_NOT_FOUND });
    }
    if (!password || !user.comparePassword(password)) {
      return reply.status(401).send({ message: msg.WRONG_PASSWORD });
    }

    // Seats of the user in running games. A seat that is not surrendered means
    // the others are still waiting for this player's turns.
    const runningSeats = await GameUser.findAll({
      where: { userID: id },
      include: [{ model: Game, where: { status: 'started' }, required: true }],
    });
    if (runningSeats.some((seat) => !seat.isSurrendered)) {
      return reply.status(409).send({ message: msg.ACTIVE_GAME });
    }

    try {
      const { io } = fastify;
      // Leave every waiting room like with "Kilépés": the room goes to the next
      // player, or is removed when nobody else is in it. Found in the database,
      // so a seat kept for a closed tab (leave timer) is included too.
      await leaveWaitingRooms(io, id);

      await sequelize.transaction(async (transaction) => {
        await Chat.destroy({ where: { userID: id }, transaction });
        await Game.update({ winnerID: null }, { where: { winnerID: id }, transaction });

        // A game must have an owner: hand it to another participant
        // (preferably one who is still playing), or remove it if there is none.
        const owned = await Game.findAll({ where: { ownerID: id }, transaction });
        // eslint-disable-next-line no-restricted-syntax
        for (const game of owned) {
          // eslint-disable-next-line no-await-in-loop
          const heir = await GameUser.findOne({
            where: { gameID: game.id, userID: { [Op.ne]: id } },
            order: [['isSurrendered', 'ASC'], ['createdAt', 'ASC']],
            transaction,
          });
          // eslint-disable-next-line no-await-in-loop
          if (heir) await game.update({ ownerID: heir.userID }, { transaction });
          // eslint-disable-next-line no-await-in-loop
          else await game.destroy({ transaction });
        }

        await GameUser.destroy({ where: { userID: id }, transaction });
        await user.destroy({ transaction });
      });

      // The account is gone; what follows is cleanup that must not undo it.
      try {
        const files = await fs.promises.readdir('uploads');
        const avatar = files.find((f) => f.startsWith(`avatar_${id}.`));
        if (avatar) await fs.promises.unlink(`uploads/${avatar}`);
      } catch (err) {
        request.log.warn(err);
      }

      const sockets = (await io.fetchSockets()).filter((s) => s.user.id === id);
      sockets.forEach((s) => s.disconnect(true));

      // Running games the user had surrendered in: refresh the player list.
      await Promise.all(runningSeats.map(async (seat) => {
        const state = await getGameState(seat.gameID);
        if (state) io.to(`game:${seat.gameID}`).emit('game:update', state);
      }));

      return reply.status(204).send();
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ message: msg.DELETE_FAILED });
    }
  });

  fastify.post('/user/avatar', { onRequest: [fastify.auth] }, async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ message: msg.NO_FILE });
      }

      let fileBuffer;
      try {
        fileBuffer = await data.toBuffer();
      } catch (err) {
        const tooLargeErrors = [
          'FST_MULTIPART_FILE_TOO_LARGE',
          'FST_MULTIPART_FIELD_TOO_LARGE',
          'ERR_INVALID_ARG_TYPE',
          'ERR_STREAM_PREMATURE_CLOSE',
        ];

        if (
          tooLargeErrors.includes(err.code)
          || (err.message && err.message.toLowerCase().includes('too large'))
        ) {
          return reply.status(413).send({ message: msg.FILE_TOO_LARGE });
        }

        throw err;
      }

      // Only allow images
      const allowed = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!allowed.includes(data.mimetype)) {
        return reply.status(400).send({ message: msg.INVALID_FILE_TYPE });
      }

      await fs.promises.mkdir('uploads', { recursive: true });

      const ext = data.mimetype === 'image/png' ? 'png' : 'jpg';
      const fileName = `avatar_${request.user.id}.${ext}`;
      const filePath = `uploads/${fileName}`;

      // Remove old avatar if exists
      const files = await fs.promises.readdir('uploads');
      const oldAvatar = files.find((f) => f.startsWith(`avatar_${request.user.id}.`));
      if (oldAvatar) {
        await fs.promises.unlink(`uploads/${oldAvatar}`);
      }

      // Save the new avatar
      await fs.promises.writeFile(filePath, fileBuffer);

      // Save URL to user
      const user = await User.findByPk(request.user.id);
      await user.update({
        avatarURL: `/${filePath}`,
      });

      return reply.send({ avatarURL: user.avatarURL });
    } catch (err) {
      request.log.error(err);
      return reply.status(500).send({ message: msg.UPLOAD_FAILED });
    }
  });
};

module.exports.autoPrefix = '/';
