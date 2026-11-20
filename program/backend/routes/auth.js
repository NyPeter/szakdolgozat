const db = require('../models');

const { User } = db;
const { describeUserError } = require('../utils/userErrors');
const msg = require('../utils/messages');

module.exports = async (fastify) => {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({ message: msg.LOGIN_FIELDS_REQUIRED });
    }
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return reply.status(404).send({ message: msg.EMAIL_NOT_FOUND });
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      return reply.status(403).send({ message: msg.ACCOUNT_SUSPENDED(user.suspendedUntil) });
    }
    if (user.comparePassword(password)) {
      const token = fastify.jwt.sign(user.toJSON());
      return reply.status(200).send({ token });
    }

    return reply.status(401).send({ message: msg.WRONG_PASSWORD });
  });

  fastify.post('/register', async (request, reply) => {
    const { name, email, password } = request.body;
    if (!name || !email || !password) {
      return reply.status(400).send({ message: msg.REGISTER_FIELDS_REQUIRED });
    }
    try {
      const user = await User.create({
        name, email, password, avatarURL: '/uploads/default_avatar.jpg',
      });
      const token = fastify.jwt.sign(user.toJSON());
      return reply.status(201).send({ token });
    } catch (err) {
      const { status, message } = describeUserError(err);
      return reply.status(status).send({ message });
    }
  });
};

module.exports.autoPrefix = '/';
