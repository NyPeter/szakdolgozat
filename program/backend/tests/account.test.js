// Integration tests: the user's own account (profile, password, deletion)
// and the admin routes (user list, suspend, mute).
const msg = require('../utils/messages');
const {
  db, startServer, emit, waitFor, sleep, PASSWORD,
} = require('./helpers');

let server;
let userCount = 0;
beforeAll(async () => { server = await startServer(); });
afterAll(() => server.close());

const newUser = async () => {
  userCount += 1;
  return server.register(`member${userCount}`);
};

describe('profile', () => {
  test('GET /user returns the own account without the password', async () => {
    const user = await newUser();
    const res = await server.request('GET', '/user', { token: user.token });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, name: user.name, avatarURL: '/uploads/default_avatar.jpg' });
    expect(res.body.user.password).toBeUndefined();
  });

  test('PUT /user changes the name and the email', async () => {
    const user = await newUser();
    const res = await server.request('PUT', '/user', {
      token: user.token, body: { name: `${user.name}-new`, email: `${user.name}-new@test.hu` },
    });
    expect(res.status).toBe(200);
    const stored = await db.User.findByPk(user.id);
    expect(stored.name).toBe(`${user.name}-new`);
    expect(stored.email).toBe(`${user.name}-new@test.hu`);
  });

  test('a name or email that is taken, or an invalid email, is refused', async () => {
    const a = await newUser();
    const b = await newUser();
    expect(await server.request('PUT', '/user', { token: b.token, body: { name: a.name } }))
      .toEqual({ status: 409, body: { message: msg.NAME_TAKEN } });
    expect(await server.request('PUT', '/user', { token: b.token, body: { email: `${a.name}@test.hu` } }))
      .toEqual({ status: 409, body: { message: msg.EMAIL_TAKEN } });
    expect(await server.request('PUT', '/user', { token: b.token, body: { email: 'nope' } }))
      .toEqual({ status: 400, body: { message: msg.INVALID_EMAIL } });
  });
});

describe('password change', () => {
  test('needs the current password, then the new one works for login', async () => {
    const user = await newUser();
    const change = (body) => server.request('PUT', '/user/password', { token: user.token, body });
    expect(await change({ currentPassword: 'wrongpass', newPassword: 'newpassword' }))
      .toEqual({ status: 401, body: { message: msg.WRONG_CURRENT_PASSWORD } });
    expect(await change({ currentPassword: PASSWORD }))
      .toEqual({ status: 400, body: { message: msg.PASSWORDS_REQUIRED } });
    expect(await change({ currentPassword: PASSWORD, newPassword: 'newpassword' }))
      .toEqual({ status: 200, body: { message: msg.PASSWORD_CHANGED } });

    const login = (password) => server.request('POST', '/login', { body: { email: `${user.name}@test.hu`, password } });
    expect((await login('newpassword')).status).toBe(200);
    expect((await login(PASSWORD)).status).toBe(401);
  });

  test('the new password must be at least 8 characters', async () => {
    const user = await newUser();
    expect(await server.request('PUT', '/user/password', {
      token: user.token, body: { currentPassword: PASSWORD, newPassword: 'short' },
    })).toEqual({ status: 400, body: { message: msg.PASSWORD_TOO_SHORT } });
  });
});

describe('account deletion', () => {
  const del = (user, password = PASSWORD) => server.request('DELETE', '/user', { token: user.token, body: { password } });

  test('needs the password', async () => {
    const user = await newUser();
    expect(await del(user, 'wrongpass')).toEqual({ status: 401, body: { message: msg.WRONG_PASSWORD } });
    expect(await db.User.findByPk(user.id)).not.toBeNull();
  });

  test('removes the account, its messages, and ends its socket connections', async () => {
    const owner = await newUser();
    const user = await newUser();
    const ownerSocket = await server.connect(owner);
    const socket = await server.connect(user);
    const { gameId } = await emit(ownerSocket, 'game:create');
    await emit(socket, 'game:join', { gameId, password: null });
    await emit(socket, 'chat:send', { message: 'bye' });

    const closed = waitFor(socket, 'disconnect');
    expect((await del(user)).status).toBe(204);
    await closed;
    expect(await db.User.findByPk(user.id)).toBeNull();
    expect(await db.Chat.count({ where: { userID: user.id } })).toBe(0);
    expect(await db.GameUser.count({ where: { userID: user.id } })).toBe(0);
    expect((await server.request('GET', '/user', { token: user.token })).status).toBe(401);
  });

  test('an owner leaving this way hands the room to the next player', async () => {
    const owner = await newUser();
    const guest = await newUser();
    const ownerSocket = await server.connect(owner);
    const guestSocket = await server.connect(guest);
    const { gameId } = await emit(ownerSocket, 'game:create');
    await emit(guestSocket, 'game:join', { gameId, password: null });

    expect((await del(owner)).status).toBe(204);
    expect((await db.Game.findByPk(gameId)).ownerID).toBe(guest.id);
  });

  test('a room whose only player deletes the account is removed, even with a closed tab', async () => {
    const owner = await newUser();
    const socket = await server.connect(owner);
    const { gameId } = await emit(socket, 'game:create');
    socket.disconnect(); // the seat is kept for the grace period
    await sleep(100);
    expect((await del(owner)).status).toBe(204);
    expect(await db.Game.findByPk(gameId)).toBeNull();
  });
});

describe('admin routes', () => {
  let admin;
  beforeAll(async () => {
    admin = await newUser();
    await db.User.update({ isAdmin: true }, { where: { id: admin.id } });
  });

  test('a normal user gets 403', async () => {
    const user = await newUser();
    expect(await server.request('GET', '/admin/users/1', { token: user.token }))
      .toEqual({ status: 403, body: { message: msg.FORBIDDEN } });
    expect((await server.request('PUT', `/admin/user/${admin.id}/suspend`, { token: user.token, body: { days: 1 } })).status)
      .toBe(403);
  });

  test('admin rights are read from the database, so revoking them works at once', async () => {
    const other = await newUser();
    await db.User.update({ isAdmin: true }, { where: { id: other.id } });
    expect((await server.request('GET', '/admin/users/1', { token: other.token })).status).toBe(200);
    await db.User.update({ isAdmin: false }, { where: { id: other.id } });
    expect((await server.request('GET', '/admin/users/1', { token: other.token })).status).toBe(403);
  });

  test('the user list is paged and searchable by name, without passwords', async () => {
    const res = await server.request('GET', `/admin/users/1?name=${admin.name}`, { token: admin.token });
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([expect.objectContaining({ id: admin.id, isAdmin: true })]);
    expect(res.body.users[0].password).toBeUndefined();
    expect(res.body).toMatchObject({ total: 1, page: 1, pages: 1 });
  });

  test('suspending: the user is locked out, -1 means indefinitely, 0 lifts it', async () => {
    const user = await newUser();
    const suspend = (days) => server.request('PUT', `/admin/user/${user.id}/suspend`, { token: admin.token, body: { days } });

    expect(await suspend(3)).toEqual({ status: 200, body: { ok: true } });
    expect((await server.request('GET', '/user', { token: user.token })).status).toBe(403);

    await suspend(-1);
    expect((await db.User.findByPk(user.id)).suspendedUntil.getFullYear()).toBe(2099);

    await suspend(0);
    expect((await db.User.findByPk(user.id)).suspendedUntil).toBeNull();
    expect((await server.request('GET', '/user', { token: user.token })).status).toBe(200);
  });

  test('muting stops the chat', async () => {
    const user = await newUser();
    const socket = await server.connect(user);
    await emit(socket, 'game:create');
    expect(await server.request('PUT', `/admin/user/${user.id}/mute`, { token: admin.token, body: { days: 1 } }))
      .toEqual({ status: 200, body: { ok: true } });
    expect(await emit(socket, 'chat:send', { message: 'hello' })).toEqual({ error: msg.MUTED });
  });

  test('an admin cannot be suspended, and a missing user is reported', async () => {
    const other = await newUser();
    await db.User.update({ isAdmin: true }, { where: { id: other.id } });
    expect(await server.request('PUT', `/admin/user/${other.id}/suspend`, { token: admin.token, body: { days: 1 } }))
      .toEqual({ status: 403, body: { message: msg.CANNOT_MODIFY_ADMIN } });
    expect(await server.request('PUT', '/admin/user/999999/mute', { token: admin.token, body: { days: 1 } }))
      .toEqual({ status: 404, body: { message: msg.USER_NOT_FOUND } });
  });
});

describe('leaderboard', () => {
  test('ranks players by wins', async () => {
    const winner = await newUser();
    const loser = await newUser();
    const finished = await db.Game.create({ status: 'finished', ownerID: winner.id, winnerID: winner.id });
    await db.GameUser.bulkCreate([
      { gameID: finished.id, userID: winner.id }, { gameID: finished.id, userID: loser.id },
    ]);
    const res = await server.request('GET', '/leaderboard/1', { token: loser.token });
    expect(res.status).toBe(200);
    // the only player in this test database with a win comes first
    expect(res.body.rows[0]).toEqual({ id: winner.id, name: winner.name, gamesWon: 1 });
    expect(res.body.rows.find((r) => r.id === loser.id)?.gamesWon ?? 0).toBe(0);
    expect(res.body.count).toBe(await db.User.count());
  });
});
