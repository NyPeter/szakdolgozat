const db = require('../models');

const { User, Game } = db;

module.exports = async (fastify) => {
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
};

module.exports.autoPrefix = '/';
