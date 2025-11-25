// const { StatusCodes } = require('http-status-codes');
// const S = require('fluent-json-schema');
const fs = require('fs');
const db = require('../models');

// eslint-disable-next-line no-unused-vars
const { Sequelize, sequelize } = db;
const { ValidationError, DatabaseError } = Sequelize;
const { User, Game } = db;

module.exports = (fastify, opts, next) => {
  fastify.get('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    const user = await User.findByPk(request.user.id);
    reply.send({ user });
  });

  fastify.put('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    const { id } = request.user;
    const {
      email,
      name,
      password,
    } = request.body;
    const user = await User.findByPk(id);
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    await user.update({
      name: name ?? user.name,
      email: email ?? user.email,
      password: password ?? user.password,
    });
    return reply.send(user);
  });

  fastify.post('/user/avatar', { onRequest: [fastify.auth] }, async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
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
          return reply.status(413).send({ error: 'File exceeds 5MB limit' });
        }

        throw err;
      }

      // Only allow images
      const allowed = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!allowed.includes(data.mimetype)) {
        return reply.status(400).send({ error: 'Invalid file type' });
      }

      await fs.promises.mkdir('uploads', { recursive: true });

      const ext = data.mimetype === 'image/png' ? 'png' : 'jpg';
      const fileName = `avatar_${request.user.id}.${ext}`;
      const filePath = `uploads/${fileName}`;

      // Save the new avatar
      await fs.promises.writeFile(filePath, fileBuffer);

      // Save URL to user
      const user = await User.findByPk(request.user.id);
      await user.update({
        avatarURL: `/${filePath}`,
      });

      return reply.send({ avatarURL: user.avatarURL });
    } catch (err) {
      return reply.status(500).send({ error: 'Upload failed' });
    }
  });

  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({ message: 'Nem adtál meg emailt vagy jelszót.' });
    }
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return reply.status(404).send({ message: 'A megadott email címmel nem létezik felhasználó.' });
    }
    if (user.comparePassword(password)) {
      const token = fastify.jwt.sign(user.toJSON());
      return reply.status(200).send({ token });
    }

    return reply.status(201).send({ message: 'A megadott jelszó helytelen.' });
  });

  fastify.post('/register', async (request, reply) => {
    const { name, email, password } = request.body;
    if (!name || !email || !password) {
      return reply.status(400).send({ message: 'Nem adtál meg nevet, emailt vagy jelszót.' });
    }
    const user = await User.create({ name, email, password });
    const token = fastify.jwt.sign(user.toJSON());
    return reply.status(201).send({ token });
  });

  fastify.get('/games/:page', { onRequest: [fastify.auth] }, async (request, reply) => {
    try {
      const page = Number(request.params.page) || 1;
      const limit = 10;
      const offset = (page - 1) * limit;

      const { rows, count } = await Game.findAndCountAll({
        where: { status: 'waiting' },
        include: [
          {
            model: User,
            as: 'Owner',
            attributes: ['id', 'name'],
          },
          {
            model: User,
            as: 'Players',
            attributes: ['id'],
            through: { attributes: [] },
          },
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        distinct: true,
      });

      const formatted = rows.map((game) => ({
        id: game.id,
        status: game.status,
        owner: game.Owner?.name,
        playerCount: game.Players.length,
      }));

      return reply.send({ rows: formatted, count });
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/leaderboard/:page', { onRequest: [fastify.auth] }, async (request, reply) => {
    const page = Number(request.params.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const { rows, count } = await User.findAndCountAll({
      attributes: [
        'id',
        'name',
        [Sequelize.literal('(SELECT COUNT(*) FROM Games WHERE Games.winnerID = User.id)'), 'gamesWon'],
      ],
      order: [[Sequelize.literal('gamesWon'), 'DESC']],
      limit,
      offset,
    });
    return reply.send({ rows, count });
  });

  fastify.addHook('onError', async (request, reply, error) => {
    if (error instanceof ValidationError || error instanceof DatabaseError) {
      reply.status(400).send({
        name: error.name,
        message: error.message,
        stack: error.stack.split(/$\s+/gm),
      });
    }
  });

  next();
};

module.exports.autoPrefix = '/';
