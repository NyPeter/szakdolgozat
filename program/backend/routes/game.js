const db = require('../models');
const { getRoomSettings } = require('../socket/gameManager');

const { User, Game, GameUser } = db;

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

      const formatted = rows.map((game) => {
        const settings = getRoomSettings(game.id);
        return {
          id: game.id,
          status: game.status,
          owner: game.Owner?.name,
          playerCount: game.Players.length,
          maxPlayers: settings.maxPlayers,
          hasPassword: !!settings.password,
        };
      });

      const myGameUser = await GameUser.findOne({
        where: { userID: request.user.id, isSurrendered: false },
        include: [{
          model: Game,
          where: { status: 'started' },
          required: true,
          include: [{ model: User, as: 'Owner', attributes: ['id', 'name'] }],
        }],
      });

      return reply.send({
        rows: formatted,
        count,
        myActiveGame: myGameUser
          ? { id: myGameUser.Game.id, owner: myGameUser.Game.Owner?.name }
          : null,
      });
    } catch (err) {
      return reply.status(500).send({ error: err.message });
    }
  });
};

module.exports.autoPrefix = '/';
