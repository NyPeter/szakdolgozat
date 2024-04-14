const { StatusCodes } = require('http-status-codes');
const S = require('fluent-json-schema');
const db = require('../models');

const { Sequelize, sequelize } = db;
const { ValidationError, DatabaseError, Op } = Sequelize;
// TODO: Import models here
// const { ... } = db;

module.exports = (fastify, opts, next) => {
  fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Root endpoint' });
  });

  fastify.get('/auth-protected', { onRequest: [fastify.auth] }, async (request, reply) => {
    reply.send({ user: request.user });
  });

  next();
};

module.exports.autoPrefix = '/';
