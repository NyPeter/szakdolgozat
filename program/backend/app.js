const Fastify = require('fastify');
const autoload = require('@fastify/autoload');
const { join } = require('path');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const jwt = require('@fastify/jwt');
const cors = require('@fastify/cors');
const fastifyIO = require('fastify-socket.io');
const msg = require('./utils/messages');
const { loadCurrentUser } = require('./utils/currentUser');

const secret = process.env.JWT_SECRET || 'secret';

/**
 * Builds the Fastify app with every plugin and route, without listening.
 * server.js starts it; the integration tests start their own copy.
 *
 * @param {object} [options] - App options.
 * @param {object|boolean} [options.logger] - Fastify logger setting (false in the tests).
 * @returns {object} The Fastify instance.
 */
function buildApp({ logger = { level: 'info', file: 'fastify.log' } } = {}) {
  const fastify = Fastify({ logger });

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
    const { user, status, message } = await loadCurrentUser(request.user.id);
    if (!user) return reply.status(status).send({ message });
    request.currentUser = user;
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

  return fastify;
}

module.exports = { buildApp };
