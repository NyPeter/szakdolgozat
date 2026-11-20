const db = require('../models');

const { Sequelize, User } = db;

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
};

module.exports.autoPrefix = '/';
