/* eslint-disable jsdoc/require-jsdoc */
const { Op } = require('sequelize');
const db = require('../models');
const msg = require('../utils/messages');

const { User } = db;

module.exports = async (fastify) => {
  // Admin rights are read from the database, not from the token, so revoking
  // them takes effect immediately.
  fastify.addHook('preHandler', async (request, reply) => {
    await fastify.auth(request, reply);
    if (reply.sent) return reply;
    if (!request.currentUser.isAdmin) {
      return reply.status(403).send({ message: msg.FORBIDDEN });
    }
    return undefined;
  });

  fastify.get('/admin/users/:page', async (request, reply) => {
    const page = Math.max(1, parseInt(request.params.page, 10) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const { name } = request.query;

    const where = name ? { name: { [Op.like]: `%${name}%` } } : {};

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: ['id', 'name', 'email', 'isAdmin', 'suspendedUntil', 'mutedUntil'],
      order: [['id', 'ASC']],
      limit,
      offset,
    });

    return reply.send({
      users: rows,
      total: count,
      page,
      pages: Math.ceil(count / limit),
    });
  });

  async function applyDateField(request, reply, field) {
    const targetId = parseInt(request.params.id, 10);
    const { days } = request.body;

    const target = await User.findByPk(targetId);
    if (!target) return reply.status(404).send({ message: msg.USER_NOT_FOUND });
    if (target.isAdmin) return reply.status(403).send({ message: msg.CANNOT_MODIFY_ADMIN });

    let date = null;
    if (days === -1) {
      date = new Date('2099-01-01');
    } else if (typeof days === 'number' && days > 0) {
      date = new Date();
      date.setDate(date.getDate() + days);
    }

    await target.update({ [field]: date });
    return reply.send({ ok: true });
  }

  fastify.put('/admin/user/:id/suspend', (req, reply) => applyDateField(req, reply, 'suspendedUntil'));
  fastify.put('/admin/user/:id/mute', (req, reply) => applyDateField(req, reply, 'mutedUntil'));
};

module.exports.autoPrefix = '/';
