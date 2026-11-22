// Integration tests: registration, login and the token check (REST).
const msg = require('../utils/messages');
const { db, startServer, PASSWORD } = require('./helpers');

let server;
beforeAll(async () => { server = await startServer(); });
afterAll(() => server.close());

describe('POST /register', () => {
  test('creates the account and returns a working token', async () => {
    const res = await server.request('POST', '/register', {
      body: { name: 'anna', email: 'anna@test.hu', password: PASSWORD },
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));

    const me = await server.request('GET', '/user', { token: res.body.token });
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ name: 'anna', email: 'anna@test.hu', isAdmin: false });
  });

  test('the password is stored hashed and never sent back', async () => {
    const { token } = await server.register('bela');
    const stored = await db.User.findOne({ where: { name: 'bela' } });
    expect(stored.password).not.toBe(PASSWORD);
    expect(stored.comparePassword(PASSWORD)).toBe(true);

    const me = await server.request('GET', '/user', { token });
    expect(me.body.user.password).toBeUndefined();
  });

  test.each([
    [{ email: 'x@test.hu', password: PASSWORD }, 400, msg.REGISTER_FIELDS_REQUIRED],
    [{ name: 'x', email: 'not-an-email', password: PASSWORD }, 400, msg.INVALID_EMAIL],
    [{ name: 'x', email: 'x@test.hu', password: 'short' }, 400, msg.PASSWORD_TOO_SHORT],
    [{ name: 'anna', email: 'other@test.hu', password: PASSWORD }, 409, msg.NAME_TAKEN],
    [{ name: 'other', email: 'anna@test.hu', password: PASSWORD }, 409, msg.EMAIL_TAKEN],
  ])('rejects %j with %i', async (body, status, message) => {
    const res = await server.request('POST', '/register', { body });
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ message });
  });
});

describe('POST /login', () => {
  test('correct email and password give a token', async () => {
    const res = await server.request('POST', '/login', {
      body: { email: 'anna@test.hu', password: PASSWORD },
    });
    expect(res.status).toBe(200);
    const me = await server.request('GET', '/user', { token: res.body.token });
    expect(me.body.user.name).toBe('anna');
  });

  test.each([
    [{ email: 'anna@test.hu' }, 400, msg.LOGIN_FIELDS_REQUIRED],
    [{ email: 'nobody@test.hu', password: PASSWORD }, 404, msg.EMAIL_NOT_FOUND],
    [{ email: 'anna@test.hu', password: 'wrongpass' }, 401, msg.WRONG_PASSWORD],
  ])('rejects %j with %i', async (body, status, message) => {
    const res = await server.request('POST', '/login', { body });
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ message });
  });

  test('a suspended user cannot log in', async () => {
    await server.register('cili');
    const until = new Date(Date.now() + 24 * 3600 * 1000);
    await db.User.update({ suspendedUntil: until }, { where: { name: 'cili' } });
    const res = await server.request('POST', '/login', {
      body: { email: 'cili@test.hu', password: PASSWORD },
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ message: msg.ACCOUNT_SUSPENDED(until) });
  });

  test('an expired suspension does not block the login', async () => {
    await db.User.update({ suspendedUntil: new Date(Date.now() - 1000) }, { where: { name: 'cili' } });
    const res = await server.request('POST', '/login', {
      body: { email: 'cili@test.hu', password: PASSWORD },
    });
    expect(res.status).toBe(200);
  });
});

describe('the token check on protected routes', () => {
  test('no token or a forged token: 401', async () => {
    expect((await server.request('GET', '/user')).status).toBe(401);
    const forged = server.app.jwt.sign({ id: 1 }, { key: 'not-the-secret' });
    const res = await server.request('GET', '/user', { token: forged });
    expect(res).toEqual({ status: 401, body: { message: msg.UNAUTHORIZED } });
  });

  test('the token of a deleted account no longer works', async () => {
    const user = await server.register('dani');
    await db.User.destroy({ where: { id: user.id } });
    const res = await server.request('GET', '/user', { token: user.token });
    expect(res.status).toBe(401);
  });

  test('a user suspended after login is turned away at once', async () => {
    const user = await server.register('emma');
    await db.User.update({ suspendedUntil: new Date('2099-01-01') }, { where: { id: user.id } });
    const res = await server.request('GET', '/user', { token: user.token });
    expect(res.status).toBe(403);
  });

  test('a suspended user cannot open a socket connection either', async () => {
    const user = await server.register('feri');
    await db.User.update({ suspendedUntil: new Date('2099-01-01') }, { where: { id: user.id } });
    await expect(server.connect(user)).rejects.toThrow(msg.ACCOUNT_SUSPENDED(new Date('2099-01-01')));
  });

  test('unknown routes answer 404 in the usual { message } shape', async () => {
    const res = await server.request('GET', '/no-such-route');
    expect(res).toEqual({ status: 404, body: { message: msg.NOT_FOUND } });
  });
});
