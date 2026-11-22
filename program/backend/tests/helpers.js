/* eslint-disable jsdoc/require-jsdoc */
// Shared helpers for the integration tests: a real server on a random port,
// the test database, HTTP requests and Socket.IO clients.
const path = require('path');
const { io: ioClient } = require('socket.io-client');
const { buildApp } = require('../app');
const { initSocket } = require('../socket');
const db = require('../models');
const store = require('../socket/store');
const { storage } = require('./setup/testDb');

if (path.resolve(db.sequelize.options.storage) !== storage) {
  throw new Error(`Tests must use the test database, not ${db.sequelize.options.storage}`);
}

const PASSWORD = 'password1';

// Empties every table, so each test file starts from a clean database.
async function resetDb() {
  await db.Chat.destroy({ where: {} });
  await db.GameUser.destroy({ where: {} });
  await db.Game.destroy({ where: {} });
  await db.User.destroy({ where: {} });
}

// Starts the app like server.js does, on a free port.
async function startServer() {
  // The socket layer logs every connection; keep the test output readable.
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await resetDb();
  const app = buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  initSocket(app.io);
  const url = `http://127.0.0.1:${app.server.address().port}`;
  const clients = [];

  // A REST request through Fastify's inject (no network needed).
  const request = async (method, url_, { token, body } = {}) => {
    const res = await app.inject({
      method,
      url: url_,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload: body,
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };

  // Registers a user and returns { id, name, token }.
  const register = async (name) => {
    const res = await request('POST', '/register', {
      body: { name, email: `${name}@test.hu`, password: PASSWORD },
    });
    if (res.status !== 201) throw new Error(`register ${name}: ${JSON.stringify(res.body)}`);
    const user = await db.User.findOne({ where: { name } });
    return { id: user.id, name, token: res.body.token };
  };

  // A Socket.IO client like the browser's (one per tab).
  // Every event it receives is recorded in socket.received.
  const connect = (user) => new Promise((resolve, reject) => {
    const socket = ioClient(url, {
      auth: { token: user.token }, transports: ['websocket'], forceNew: true, reconnection: false,
    });
    socket.received = [];
    socket.onAny((event, data) => socket.received.push({ event, data }));
    clients.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });

  const close = async () => {
    clients.forEach((s) => s.disconnect());
    // Closing the server disconnects every socket; their disconnect handlers
    // start leave timers. Only after that can every timer be cleared, so none
    // of them runs after the database is closed.
    await app.close();
    store.turnTimers.forEach((t) => clearTimeout(t));
    store.turnTimers.clear();
    store.leaveTimers.forEach((t) => clearTimeout(t));
    store.leaveTimers.clear();
    await db.sequelize.close();
    // eslint-disable-next-line no-console
    console.log.mockRestore();
  };

  return {
    app, url, request, register, connect, close,
  };
}

// Sends an event and resolves with the server's callback answer.
function emit(socket, event, data = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, data, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

// Resolves with the next `event` the socket receives.
function waitFor(socket, event, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within ${timeout} ms`)), timeout);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

// Seats in the database, for checking what the server stored.
const playersOf = async (gameId) => (await db.GameUser.findAll({ where: { gameID: gameId } }))
  .map((s) => s.userID).sort((a, b) => a - b);
const roomsOf = async (userId) => (await db.GameUser.findAll({ where: { userID: userId } }))
  .map((s) => s.gameID);

module.exports = {
  db, startServer, emit, waitFor, sleep, playersOf, roomsOf, PASSWORD,
};
