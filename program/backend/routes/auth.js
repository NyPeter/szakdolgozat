const db = require('../models');

const { User } = db;

module.exports = async (fastify) => {
  fastify.post('/login', async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({ message: 'Nem adtál meg emailt vagy jelszót.' });
    }
    const user = await User.findOne({ where: { email } });
    if (!user) {
      return reply.status(404).send({ message: 'A megadott email címmel nem létezik felhasználó.' });
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      const until = new Date(user.suspendedUntil).toLocaleDateString('hu-HU');
      return reply.status(403).send({ message: `A fiókod fel van függesztve ${until}-ig.` });
    }
    if (user.comparePassword(password)) {
      const token = fastify.jwt.sign(user.toJSON());
      return reply.status(200).send({ token });
    }

    return reply.status(201).send({ message: 'A megadott jelszó helytelen.' });
  });

  fastify.post('/register', async (request, reply) => {
    const { name, email, password } = request.body;
    if (!name || !email || !password) {
      return reply.status(400).send({ message: 'Nem adtál meg nevet, emailt vagy jelszót.' });
    }
    const user = await User.create({ name, email, password, avatarURL: '/uploads/default_avatar.jpg' });
    const token = fastify.jwt.sign(user.toJSON());
    return reply.status(201).send({ token });
  });
};

module.exports.autoPrefix = '/';
