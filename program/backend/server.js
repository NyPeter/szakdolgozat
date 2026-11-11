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
  } catch (err) {
    reply.send(err);
  }
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
  .then(() => {
    fastify.listen({ port }, (err, address) => {
      if (err) throw err;

      // eslint-disable-next-line no-console
      console.log(`Server listening on ${address}`);

      initSocket(fastify.io);
    });
  });
