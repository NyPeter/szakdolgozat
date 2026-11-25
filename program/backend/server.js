require('dotenv').config();
const { initSocket } = require('./socket');
const { buildApp } = require('./app');
const db = require('./models');

const port = process.env.PORT || 4000;

const fastify = buildApp();

db.sequelize.query('PRAGMA journal_mode = WAL;')
  .then(() => db.sequelize.query('PRAGMA busy_timeout = 5000;'))
  // Cards, scores and room settings are kept in memory only, so a game that was
  // waiting or running when the server stopped cannot be continued. Remove them,
  // otherwise their players would stay locked in an "active game" forever.
  .then(() => db.Game.destroy({ where: { status: ['waiting', 'started'] } }))
  .then(() => {
    fastify.listen({ port }, (err, address) => {
      if (err) throw err;

      console.log(`Server listening on ${address}`);

      initSocket(fastify.io);
    });
  });
