require('dotenv').config();
const Fastify = require('fastify');
const autoload = require('@fastify/autoload');
const { join } = require('path');

const port = process.env.PORT || 4000;
const secret = process.env.JWT_SECRET || 'secret';

// Initialize Fastify
const fastify = Fastify({
  logger: {
    level: 'info',
    file: 'fastify.log',
  },
});

// Set up JWT authentication
fastify.register(require('@fastify/jwt'), {
  secret,
});

fastify.decorate('auth', async (request, reply) => {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.send(err);
  }
});

// Autoload routes from the routes directory
fastify.register(autoload, {
  dir: join(__dirname, 'routes'),
});

// Start the server
fastify.listen({ port }, (err, address) => {
  if (err) throw err;

  // eslint-disable-next-line no-console
  console.log(`Server listening on ${address}`);
});
