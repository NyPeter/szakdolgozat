const db = require('../models');

// eslint-disable-next-line no-unused-vars
const { Sequelize, sequelize } = db;
const { ValidationError, DatabaseError } = Sequelize;
const { User } = db;

module.exports = async (fastify) => {
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
};

module.exports.autoPrefix = '/';
