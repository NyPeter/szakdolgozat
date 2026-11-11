const fs = require('fs');
const db = require('../models');

const { User } = db;

module.exports = async (fastify) => {
  fastify.get('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    const user = await User.findByPk(request.user.id);
    reply.send({ user });
  });

  fastify.put('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    const { id } = request.user;
    const { email, name } = request.body;
    const user = await User.findByPk(id);
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    await user.update({
      name: name ?? user.name,
      email: email ?? user.email,
    });
    return reply.send(user);
  });

  fastify.put('/user/password', { onRequest: [fastify.auth] }, async (request, reply) => {
    const { id } = request.user;
    const { currentPassword, newPassword } = request.body;
    const user = await User.findByPk(id);
    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }
    if (user.comparePassword(currentPassword)) {
      await user.update({
        password: newPassword ?? user.password,
      });
      return reply.send({ message: 'Password updated.' });
    }
    return reply.status(401).send({ message: 'Current password doesn\'t match!' });
  });

  fastify.delete('/user', { onRequest: [fastify.auth] }, async (request, reply) => {
    try {
      const { id } = request.user;

      const user = await User.findByPk(id);

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Delete avatar file if exists
      const files = await fs.promises.readdir('uploads');
      const oldAvatar = files.find((f) => f.startsWith(`avatar_${request.user.id}.`));
      if (oldAvatar) {
        await fs.promises.unlink(`uploads/${oldAvatar}`);
      }

      await user.destroy();

      return reply.status(204).send({ message: 'User account deleted successfully.' });
    } catch (err) {
      return reply.status(500).send({ message: `Error deleting avatar: ${err}` });
    }
  });

  fastify.post('/user/avatar', { onRequest: [fastify.auth] }, async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      let fileBuffer;
      try {
        fileBuffer = await data.toBuffer();
      } catch (err) {
        const tooLargeErrors = [
          'FST_MULTIPART_FILE_TOO_LARGE',
          'FST_MULTIPART_FIELD_TOO_LARGE',
          'ERR_INVALID_ARG_TYPE',
          'ERR_STREAM_PREMATURE_CLOSE',
        ];

        if (
          tooLargeErrors.includes(err.code)
          || (err.message && err.message.toLowerCase().includes('too large'))
        ) {
          return reply.status(413).send({ error: 'File exceeds 5MB limit' });
        }

        throw err;
      }

      // Only allow images
      const allowed = ['image/png', 'image/jpeg', 'image/jpg'];
      if (!allowed.includes(data.mimetype)) {
        return reply.status(400).send({ error: 'Invalid file type' });
      }

      await fs.promises.mkdir('uploads', { recursive: true });

      const ext = data.mimetype === 'image/png' ? 'png' : 'jpg';
      const fileName = `avatar_${request.user.id}.${ext}`;
      const filePath = `uploads/${fileName}`;

      // Remove old avatar if exists
      const files = await fs.promises.readdir('uploads');
      const oldAvatar = files.find((f) => f.startsWith(`avatar_${request.user.id}.`));
      if (oldAvatar) {
        await fs.promises.unlink(`uploads/${oldAvatar}`);
      }

      // Save the new avatar
      await fs.promises.writeFile(filePath, fileBuffer);

      // Save URL to user
      const user = await User.findByPk(request.user.id);
      await user.update({
        avatarURL: `/${filePath}`,
      });

      return reply.send({ avatarURL: user.avatarURL });
    } catch (err) {
      return reply.status(500).send({ error: 'Upload failed' });
    }
  });
};

module.exports.autoPrefix = '/';
