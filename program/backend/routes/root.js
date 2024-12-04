// const { StatusCodes } = require('http-status-codes');
// const S = require('fluent-json-schema');
const db = require('../models');

// eslint-disable-next-line no-unused-vars
const { Sequelize, sequelize } = db;
const { ValidationError, DatabaseError } = Sequelize;
const { User } = db;

module.exports = (fastify, opts, next) => {
  fastify.get('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    reply.send({ user: request.user });
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

  // fastify.get('/games/', async (request, reply) => {
  // });

  fastify.get('/leaderboard/:page', { onRequest: [fastify.auth] }, async (request, reply) => {
    const offset = (request.params.page - 1) * 20;
    const { rows, count } = await User.findAndCountAll({
      attributes: [
        'id',
        'name',
        [Sequelize.literal('(SELECT COUNT(*) FROM Games WHERE Games.winnerID = User.id)'), 'gamesWon'],
      ],
      order: [[Sequelize.literal('gamesWon'), 'DESC']],
      limit: 20,
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
