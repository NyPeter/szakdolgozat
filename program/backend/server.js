require('dotenv').config();
const Fastify = require('fastify');
const autoload = require('@fastify/autoload');
const { join } = require('path');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const jwt = require('@fastify/jwt');
const cors = require('@fastify/cors');
const fastifyIO = require('fastify-socket.io');
// eslint-disable-next-line import/extensions
const { initSocket } = require('./socket/index.js');
const db = require('./models');
const msg = require('./utils/messages');

const port = process.env.PORT || 4000;
const secret = process.env.JWT_SECRET || 'secret';

const fastify = Fastify({
  logger: {
    level: 'info',
    file: 'fastify.log',
  },
});

fastify.register(cors, {
  origin: 'http://localhost:5173',
});

fastify.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

fastify.register(fastifyStatic, {
  root: join(__dirname, 'uploads'),
  prefix: '/uploads/',
});

fastify.register(jwt, {
  secret,
});

fastify.decorate('auth', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ message: msg.UNAUTHORIZED });
  }
  return undefined;
});

// Errors that a route does not handle itself: log the real error and send a
// general message in the same { message } shape as every other response.
fastify.setErrorHandler((err, request, reply) => {
  request.log.error(err);
  const status = err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
  reply.status(status).send({ message: status === 500 ? msg.SERVER_ERROR : msg.INVALID_REQUEST });
});

fastify.setNotFoundHandler((request, reply) => {
  reply.status(404).send({ message: msg.NOT_FOUND });
});

fastify.register(autoload, {
  dir: join(__dirname, 'routes'),
});

fastify.register(fastifyIO, {
  cors: { origin: 'http://localhost:5173' },
  transports: ['websocket'],
});

db.sequelize.query('PRAGMA journal_mode = WAL;')
  .then(() => db.sequelize.query('PRAGMA busy_timeout = 5000;'))
  // Cards, scores and room settings are kept in memory only, so a game that was
  // waiting or running when the server stopped cannot be continued. Remove them,
  // otherwise their players would stay locked in an "active game" forever.
  .then(() => db.Game.destroy({ where: { status: ['waiting', 'started'] } }))
  .then(() => {
    fastify.listen({ port }, (err, address) => {
      if (err) throw err;

      // eslint-disable-next-line no-console
      console.log(`Server listening on ${address}`);

      initSocket(fastify.io);
    });
  });
