// Integration tests: waiting rooms over Socket.IO (create, join, settings,
// kick, leave, start) and the GET /games room list.
const msg = require('../utils/messages');
const {
  db, startServer, emit, waitFor, sleep, playersOf, roomsOf,
} = require('./helpers');

const GRACE = Number(process.env.LEAVE_GRACE_MS);

let server;
let userCount = 0;
beforeAll(async () => { server = await startServer(); });
afterAll(() => server.close());

// n new users, each with one connected socket (a browser tab)
const players = async (n) => Promise.all(Array.from({ length: n }, async () => {
  userCount += 1;
  const user = await server.register(`player${userCount}`);
  return { ...user, socket: await server.connect(user) };
}));

// The owner creates a room, the others join it.
const roomWith = async (owner, ...others) => {
  const { gameId } = await emit(owner.socket, 'game:create');
  await Promise.all(others.map((p) => emit(p.socket, 'game:join', { gameId, password: null })));
  return gameId;
};

const disconnect = async (socket) => { socket.disconnect(); await sleep(100); };

describe('creating and joining a room', () => {
  test('the creator becomes the owner and gets the room state', async () => {
    const [anna] = await players(1);
    const joined = waitFor(anna.socket, 'game:joined');
    const res = await emit(anna.socket, 'game:create');
    expect(res).toEqual({ ok: true, gameId: expect.any(Number) });

    const state = await joined;
    expect(state).toMatchObject({
      id: res.gameId, status: 'waiting', owner: { id: anna.id }, maxPlayers: 6, hasPassword: false,
    });
    expect((await db.Game.findByPk(res.gameId)).ownerID).toBe(anna.id);
  });

  test('a joining player is announced to everyone in the room', async () => {
    const [owner, guest] = await players(2);
    const { gameId } = await emit(owner.socket, 'game:create');
    const update = waitFor(owner.socket, 'game:update');
    expect(await emit(guest.socket, 'game:join', { gameId, password: null }))
      .toEqual({ ok: true, created: true });
    expect((await update).players.map((p) => p.id)).toEqual([owner.id, guest.id]);
    expect(await playersOf(gameId)).toEqual([owner.id, guest.id]);
  });

  test('the room shows up in GET /games with its player count', async () => {
    const [owner, guest] = await players(2);
    const gameId = await roomWith(owner, guest);
    const res = await server.request('GET', '/games/1', { token: owner.token });
    expect(res.status).toBe(200);
    expect(res.body.rows).toContainEqual({
      id: gameId, status: 'waiting', owner: owner.name, playerCount: 2, maxPlayers: 6, hasPassword: false,
    });
  });

  test('a missing room is reported', async () => {
    const [anna] = await players(1);
    expect(await emit(anna.socket, 'game:join', { gameId: 999999, password: null }))
      .toEqual({ error: msg.ROOM_NOT_FOUND });
  });
});

describe('room settings', () => {
  test('password: asked for, wrong one refused, right one accepted', async () => {
    const [owner, guest] = await players(2);
    const { gameId } = await emit(owner.socket, 'game:create');
    expect(await emit(owner.socket, 'game:settings', { maxPlayers: 6, password: 'titok' })).toEqual({ ok: true });

    expect(await emit(guest.socket, 'game:join', { gameId, password: null }))
      .toEqual({ error: msg.WRONG_PASSWORD, needsPassword: true });
    expect(await emit(guest.socket, 'game:join', { gameId, password: 'rossz' }))
      .toEqual({ error: msg.WRONG_PASSWORD, needsPassword: true });
    expect((await emit(guest.socket, 'game:join', { gameId, password: 'titok' })).ok).toBe(true);
  });

  test('a full room cannot be joined', async () => {
    const [owner, guest, late] = await players(3);
    const gameId = await roomWith(owner, guest);
    await emit(owner.socket, 'game:settings', { maxPlayers: 2, password: null });
    expect(await emit(late.socket, 'game:join', { gameId, password: null }))
      .toEqual({ error: msg.ROOM_FULL });
  });

  test('the limit cannot go below the players already in the room', async () => {
    const [owner, a, b] = await players(3);
    await roomWith(owner, a, b);
    expect(await emit(owner.socket, 'game:settings', { maxPlayers: 2, password: null }))
      .toEqual({ error: msg.MAX_PLAYERS_TOO_LOW(3) });
  });

  test('only the owner may change the settings', async () => {
    const [owner, guest] = await players(2);
    await roomWith(owner, guest);
    expect(await emit(guest.socket, 'game:settings', { maxPlayers: 3, password: null }))
      .toEqual({ error: msg.OWNER_ONLY_SETTINGS });
  });
});

describe('kicking and leaving', () => {
  test('the owner can kick a player, who is told so', async () => {
    const [owner, guest] = await players(2);
    const gameId = await roomWith(owner, guest);
    const kicked = waitFor(guest.socket, 'game:kicked');
    expect(await emit(owner.socket, 'game:kick', { targetUserId: guest.id })).toEqual({ ok: true });
    await kicked;
    expect(await playersOf(gameId)).toEqual([owner.id]);
  });

  test('a player cannot kick, and the owner cannot kick themselves', async () => {
    const [owner, guest] = await players(2);
    await roomWith(owner, guest);
    expect(await emit(guest.socket, 'game:kick', { targetUserId: owner.id }))
      .toEqual({ error: msg.OWNER_ONLY_KICK });
    expect(await emit(owner.socket, 'game:kick', { targetUserId: owner.id }))
      .toEqual({ error: msg.CANNOT_KICK_SELF });
  });

  test('when the owner leaves, the next player becomes the owner', async () => {
    const [owner, second, third] = await players(3);
    const gameId = await roomWith(owner, second, third);
    const update = waitFor(second.socket, 'game:update');
    await emit(owner.socket, 'game:leave');
    expect((await update).owner.id).toBe(second.id);
    expect((await db.Game.findByPk(gameId)).ownerID).toBe(second.id);
  });

  test('when the last player leaves, the room is deleted', async () => {
    const [owner] = await players(1);
    const { gameId } = await emit(owner.socket, 'game:create');
    await emit(owner.socket, 'game:leave');
    expect(await db.Game.findByPk(gameId)).toBeNull();
  });
});

describe('one room per user', () => {
  test('joining a second room in another tab leaves the first, and that tab is told', async () => {
    const [ownerA, ownerB, guest] = await players(3);
    const roomA = await roomWith(ownerA, guest);
    const { gameId: roomB } = await emit(ownerB.socket, 'game:create');

    const secondTab = await server.connect(guest);
    const left = waitFor(guest.socket, 'game:left');
    expect((await emit(secondTab, 'game:join', { gameId: roomB, password: null })).ok).toBe(true);
    await left;
    expect(await roomsOf(guest.id)).toEqual([roomB]);
    expect(await playersOf(roomA)).toEqual([ownerA.id]);
  });

  test('creating a room leaves the current one', async () => {
    const [owner, guest] = await players(2);
    const roomA = await roomWith(owner, guest);
    const { gameId: roomB } = await emit(guest.socket, 'game:create');
    expect(await roomsOf(guest.id)).toEqual([roomB]);
    expect(await playersOf(roomA)).toEqual([owner.id]);
  });

  test('a refused join (wrong password) keeps the current seat', async () => {
    const [ownerA, ownerB, guest] = await players(3);
    const roomA = await roomWith(ownerA, guest);
    const { gameId: roomB } = await emit(ownerB.socket, 'game:create');
    await emit(ownerB.socket, 'game:settings', { maxPlayers: 6, password: 'titok' });
    expect((await emit(guest.socket, 'game:join', { gameId: roomB, password: 'rossz' })).needsPassword).toBe(true);
    expect(await roomsOf(guest.id)).toEqual([roomA]);
  });
});

describe('reload grace period', () => {
  test('a reload within the grace period keeps the seat', async () => {
    const [owner, guest] = await players(2);
    const gameId = await roomWith(owner, guest);
    await disconnect(guest.socket);
    const reloaded = await server.connect(guest);
    expect(await emit(reloaded, 'game:join', { gameId, password: null })).toEqual({ ok: true, created: false });
    await sleep(GRACE + 200);
    expect(await playersOf(gameId)).toEqual([owner.id, guest.id]);
  });

  test('during the grace period the seat still counts: the room stays full', async () => {
    const [owner, guest, late] = await players(3);
    const gameId = await roomWith(owner, guest);
    await emit(owner.socket, 'game:settings', { maxPlayers: 2, password: 'titok' });
    await disconnect(guest.socket);
    expect(await emit(late.socket, 'game:join', { gameId, password: 'titok' })).toEqual({ error: msg.ROOM_FULL });

    // ...and the returning player needs neither the password nor a free place
    const reloaded = await server.connect(guest);
    expect((await emit(reloaded, 'game:join', { gameId, password: null })).ok).toBe(true);
  });

  test('a closed tab gives up the seat after the grace period', async () => {
    const [owner, guest] = await players(2);
    const gameId = await roomWith(owner, guest);
    await disconnect(owner.socket);
    expect((await db.Game.findByPk(gameId)).ownerID).toBe(owner.id); // still the owner
    await sleep(GRACE + 200);
    expect(await playersOf(gameId)).toEqual([guest.id]);
    expect((await db.Game.findByPk(gameId)).ownerID).toBe(guest.id);
  });
});

describe('starting the game', () => {
  test('needs at least 2 players', async () => {
    const [owner] = await players(1);
    await emit(owner.socket, 'game:create');
    expect(await emit(owner.socket, 'game:start')).toEqual({ error: msg.NOT_ENOUGH_PLAYERS });
  });

  test('a player who is not the owner cannot start', async () => {
    const [owner, guest] = await players(2);
    await roomWith(owner, guest);
    expect(await emit(guest.socket, 'game:start')).toEqual({ error: msg.OWNER_ONLY_START });
  });

  test('every player gets their own view: own cards, the others only as a count', async () => {
    const [owner, guest] = await players(2);
    const gameId = await roomWith(owner, guest);
    const ownerState = waitFor(owner.socket, 'game:state');
    const guestState = waitFor(guest.socket, 'game:state');
    expect(await emit(owner.socket, 'game:start')).toEqual({ ok: true });

    const [ov, gv] = await Promise.all([ownerState, guestState]);
    expect(ov.players).toEqual([owner.id, guest.id]);
    expect(ov.hands[owner.id]).toHaveLength(15);
    expect(ov.hands[guest.id]).toEqual({ count: 14 });
    expect(gv.hands[guest.id]).toHaveLength(14);
    expect(gv.hands[owner.id]).toEqual({ count: 15 });
    expect(ov.swapCard.rank).not.toBe('Joker');
    expect((await db.Game.findByPk(gameId)).status).toBe('started');
  });

  test('a started game cannot be joined by others, and its players cannot open a new room', async () => {
    const [owner, guest, late] = await players(3);
    const gameId = await roomWith(owner, guest);
    await emit(owner.socket, 'game:start');
    expect(await emit(late.socket, 'game:join', { gameId, password: null }))
      .toEqual({ error: msg.GAME_ALREADY_STARTED });
    expect(await emit(guest.socket, 'game:create')).toEqual({ error: msg.ACTIVE_GAME });
  });

  test('a player of a started game can come back after a reload', async () => {
    const [owner, guest] = await players(2);
    const gameId = await roomWith(owner, guest);
    await emit(owner.socket, 'game:start');
    await disconnect(guest.socket);
    await sleep(GRACE + 200); // the grace period only applies to waiting rooms
    const reloaded = await server.connect(guest);
    const state = waitFor(reloaded, 'game:state');
    expect(await emit(reloaded, 'game:join', { gameId, password: null })).toEqual({ ok: true });
    expect((await state).hands[guest.id]).toHaveLength(14);
  });
});
