// Integration tests: a running game over Socket.IO — turns, drawing,
// discarding, melds, lay-offs, joker swap, round end, surrender and chat.
// Hands are set through the in-memory game state (store.gameStates), so each
// test knows exactly which cards are in play.
const msg = require('../utils/messages');
const store = require('../socket/store');
const {
  db, startServer, emit, waitFor,
} = require('./helpers');

let server;
let userCount = 0;
beforeAll(async () => { server = await startServer(); });
afterAll(() => server.close());

let nextCardId = 5000; // the decks use ids 0-164
const VALUES = {
  Jack: 10, Queen: 10, King: 10, Ace: 11, Joker: 15,
};
const card = (rank, suit = 'hearts') => ({
  id: nextCardId++, rank, suit: rank === 'Joker' ? null : suit, value: VALUES[rank] ?? parseInt(rank, 10),
});
const ids = (cards) => cards.map((c) => c.id);

const lastState = (socket) => socket.received.filter((e) => e.event === 'game:state').at(-1).data;

// Starts a game with n new players. Returns the players in turn order
// (players[0] is on turn first) and a getter for the server's game state.
const startGame = async (n) => {
  const users = await Promise.all(Array.from({ length: n }, async () => {
    userCount += 1;
    const user = await server.register(`gamer${userCount}`);
    return { ...user, socket: await server.connect(user) };
  }));
  const { gameId } = await emit(users[0].socket, 'game:create');
  await Promise.all(users.slice(1).map((u) => emit(u.socket, 'game:join', { gameId, password: null })));
  // wait until every player has the first game state, so no later waitFor
  // can pick up a start state that is still on its way
  const started = Promise.all(users.map((u) => waitFor(u.socket, 'game:state')));
  await emit(users[0].socket, 'game:start');
  await started;
  const gs = () => store.gameStates.get(gameId);
  const players = gs().players.map((id) => users.find((u) => u.id === id));
  return { gameId, players, gs };
};

const setHand = (game, player, cards) => {
  const state = game.gs();
  state.hands[String(player.id)] = cards;
};

// The first player's turn begins with 15 cards and no draw: discard to pass.
const passFirstTurn = async ({ players, gs }) => {
  const first = gs().hands[String(players[0].id)][0];
  await emit(players[0].socket, 'game:discard', { cardId: first.id });
};

describe('turn order', () => {
  test('the starting player (15 cards) discards first, without drawing', async () => {
    const game = await startGame(2);
    const [first, second] = game.players;
    expect(game.gs().phase).toBe('discard');
    expect(await emit(first.socket, 'game:draw', { source: 'deck' })).toEqual({ error: msg.ALREADY_DRAWN });

    const discard = game.gs().hands[String(first.id)][0];
    const seen = waitFor(second.socket, 'game:state');
    expect(await emit(first.socket, 'game:discard', { cardId: discard.id })).toEqual({ ok: true });

    const view = await seen;
    expect(view.discardTop).toEqual(discard);
    expect(view.hands[first.id]).toEqual({ count: 14 });
    expect(view.players[view.turnIndex]).toBe(second.id);
    expect(view.phase).toBe('draw');
  });

  test('a player who is not on turn cannot act', async () => {
    const game = await startGame(2);
    const [, second] = game.players;
    const theirCard = game.gs().hands[String(second.id)][0];
    expect(await emit(second.socket, 'game:discard', { cardId: theirCard.id })).toEqual({ error: msg.NOT_YOUR_TURN });
    expect(await emit(second.socket, 'game:draw', { source: 'deck' })).toEqual({ error: msg.NOT_YOUR_TURN });
  });

  test('drawing comes before discarding, and only once', async () => {
    const game = await startGame(2);
    await passFirstTurn(game);
    const [, second] = game.players;
    const someCard = game.gs().hands[String(second.id)][0];
    expect(await emit(second.socket, 'game:discard', { cardId: someCard.id })).toEqual({ error: msg.MUST_DRAW_FIRST });
    expect(await emit(second.socket, 'game:draw', { source: 'deck' })).toEqual({ ok: true });
    expect(await emit(second.socket, 'game:draw', { source: 'deck' })).toEqual({ error: msg.ALREADY_DRAWN });
  });

  test('a card that is not in the hand cannot be discarded', async () => {
    const game = await startGame(2);
    expect(await emit(game.players[0].socket, 'game:discard', { cardId: 99999 }))
      .toEqual({ error: msg.CARD_NOT_IN_HAND });
  });
});

describe('drawing', () => {
  test('from the deck: only the drawer learns which card it was', async () => {
    const game = await startGame(2);
    await passFirstTurn(game);
    const [first, second] = game.players;
    const before = game.gs().drawPile.length;
    const top = game.gs().drawPile.at(-1);
    await emit(second.socket, 'game:draw', { source: 'deck' });

    const own = lastState(second.socket);
    expect(own.hands[second.id]).toContainEqual(top);
    expect(own.drawnCardId).toBe(top.id);
    expect(own.drawPile.remaining).toBe(before - 1);
    expect(lastState(first.socket).drawnCardId).toBeNull();
    expect(lastState(first.socket).hands[second.id]).toEqual({ count: 15 });
  });

  test('from the discard pile after the first round: the card must be used in a meld', async () => {
    const game = await startGame(2);
    const [first, second] = game.players;
    game.gs().isFirstTurn = false;
    game.gs().hasFirstMeld[String(second.id)] = true;
    const sevens = [card('7', 'hearts'), card('7', 'spades')];
    const other = card('King', 'clubs');
    setHand(game, second, [...sevens, other]);

    const taken = card('7', 'clubs');
    setHand(game, first, [taken, card('2', 'diamonds')]);
    await emit(first.socket, 'game:discard', { cardId: taken.id });

    expect(await emit(second.socket, 'game:draw', { source: 'discard' })).toEqual({ ok: true });
    expect(await emit(second.socket, 'game:discard', { cardId: taken.id })).toEqual({ error: msg.DISCARD_TAKEN_CARD });
    expect(await emit(second.socket, 'game:discard', { cardId: other.id })).toEqual({ error: msg.USE_TAKEN_CARD_FIRST });

    expect(await emit(second.socket, 'game:meld', { groups: [[...ids(sevens), taken.id]] })).toEqual({ ok: true });
    expect(await emit(second.socket, 'game:discard', { cardId: other.id })).toEqual({ ok: true });
  });

  test('a draw from the discard pile can be taken back', async () => {
    const game = await startGame(2);
    const [first, second] = game.players;
    const discarded = game.gs().hands[String(first.id)][0];
    await emit(first.socket, 'game:discard', { cardId: discarded.id });
    await emit(second.socket, 'game:draw', { source: 'discard' });
    expect(await emit(second.socket, 'game:undoDraw')).toEqual({ ok: true });
    expect(game.gs().phase).toBe('draw');
    expect(game.gs().discardPile.at(-1)).toEqual(discarded);
    expect(game.gs().hands[String(second.id)]).toHaveLength(14);
  });

  test('a draw from the deck cannot be taken back', async () => {
    const game = await startGame(2);
    await passFirstTurn(game);
    const [, second] = game.players;
    await emit(second.socket, 'game:draw', { source: 'deck' });
    expect(await emit(second.socket, 'game:undoDraw')).toEqual({ error: msg.NOTHING_TO_UNDO });
  });
});

describe('laying down melds', () => {
  test('the first meld must be worth at least 51 points', async () => {
    const game = await startGame(2);
    const [first] = game.players;
    const low = [card('2', 'hearts'), card('3', 'hearts'), card('4', 'hearts')];
    setHand(game, first, [...low, card('9', 'clubs'), card('9', 'spades'), card('King', 'diamonds')]);
    expect(await emit(first.socket, 'game:meld', { groups: [ids(low)] }))
      .toEqual({ error: msg.FIRST_MELD_MINIMUM(9) });
  });

  test('a valid first meld goes on the table and leaves the hand', async () => {
    const game = await startGame(2);
    const [first, second] = game.players;
    const kings = [card('King', 'hearts'), card('King', 'spades'), card('King', 'clubs')];
    const run = [card('9', 'diamonds'), card('10', 'diamonds'), card('Jack', 'diamonds')];
    const rest = [card('2', 'clubs'), card('5', 'spades')];
    setHand(game, first, [...kings, ...run, ...rest]);

    const seen = waitFor(second.socket, 'game:state');
    expect(await emit(first.socket, 'game:meld', { groups: [ids(kings), ids(run)] })).toEqual({ ok: true });
    const view = await seen;
    expect(view.melds).toHaveLength(2);
    expect(view.melds.map((m) => m.type)).toEqual(['set', 'run']);
    expect(view.hands[first.id]).toEqual({ count: 2 });
    expect(view.hasFirstMeld[first.id]).toBe(true);
  });

  test('invalid groups are refused and nothing changes', async () => {
    const game = await startGame(2);
    const [first] = game.players;
    const mixed = [card('King', 'hearts'), card('Queen', 'spades'), card('2', 'clubs')];
    const hand = [...mixed, card('5', 'spades'), card('6', 'spades')];
    setHand(game, first, hand);
    expect(await emit(first.socket, 'game:meld', { groups: [ids(mixed)] })).toEqual({ error: msg.INVALID_MELD });
    expect(await emit(first.socket, 'game:meld', { groups: [ids(mixed).slice(0, 2)] })).toEqual({ error: msg.MELD_TOO_SHORT });
    expect(game.gs().melds).toEqual([]);
    expect(game.gs().hands[String(first.id)]).toHaveLength(5);
  });

  test('one card has to stay in the hand for the discard', async () => {
    const game = await startGame(2);
    const [first] = game.players;
    const aces = [card('Ace', 'hearts'), card('Ace', 'spades'), card('Ace', 'clubs')];
    setHand(game, first, aces);
    expect(await emit(first.socket, 'game:meld', { groups: [ids(aces)] })).toEqual({ error: msg.KEEP_ONE_CARD });
  });
});

describe('lay-off (szúrás) and joker swap', () => {
  // The first player has melded already (in an earlier turn) and holds `hand`;
  // the table has a 7-8-9 hearts run and a 5-5-5-joker set.
  const tableReady = async (hand) => {
    const game = await startGame(2);
    const [first] = game.players;
    const run = [card('7', 'hearts'), card('8', 'hearts'), card('9', 'hearts')];
    const set = [card('5', 'spades'), card('5', 'clubs'), card('5', 'diamonds'), card('Joker')];
    game.gs().melds.push(
      {
        id: 0, playerId: 'x', type: 'run', cards: run,
      },
      {
        id: 1, playerId: 'x', type: 'set', cards: set,
      },
    );
    game.gs().meldCounter = 2;
    game.gs().hasFirstMeld[String(first.id)] = true;
    setHand(game, first, hand);
    return {
      ...game, first, run, set,
    };
  };

  test('a fitting card can be added to a meld on the table', async () => {
    const ten = card('10', 'hearts');
    const { first, gs } = await tableReady([ten, card('2', 'clubs')]);
    expect(await emit(first.socket, 'game:layOff', { meldId: 0, cardId: ten.id })).toEqual({ ok: true });
    expect(gs().melds[0].cards.map((c) => c.rank)).toEqual(['7', '8', '9', '10']);
  });

  test('a card that does not fit is refused', async () => {
    const wrong = card('Jack', 'hearts');
    const { first } = await tableReady([wrong, card('2', 'clubs')]);
    expect(await emit(first.socket, 'game:layOff', { meldId: 0, cardId: wrong.id })).toEqual({ error: msg.CARD_DOES_NOT_FIT });
  });

  test('no lay-off before the player\'s own first meld', async () => {
    const ten = card('10', 'hearts');
    const { first, gs } = await tableReady([ten, card('2', 'clubs')]);
    gs().hasFirstMeld[String(first.id)] = false;
    expect(await emit(first.socket, 'game:layOff', { meldId: 0, cardId: ten.id }))
      .toEqual({ error: msg.LAY_OFF_BEFORE_FIRST_MELD });
  });

  test('the joker is taken with the fourth five, and must be used before discarding', async () => {
    const five = card('5', 'hearts');
    const jacks = [card('Jack', 'clubs'), card('Jack', 'spades')];
    const spare = card('2', 'clubs');
    const { first, gs, set } = await tableReady([five, ...jacks, spare]);
    const jokerId = set[3].id;

    expect(await emit(first.socket, 'game:jokerSwap', { meldId: 1, jokerId, naturalCardId: five.id })).toEqual({ ok: true });
    expect(gs().melds[1].cards.map((c) => c.rank)).toEqual(['5', '5', '5', '5']);
    expect(await emit(first.socket, 'game:discard', { cardId: spare.id })).toEqual({ error: msg.USE_JOKER_FIRST });

    expect(await emit(first.socket, 'game:meld', { groups: [[...ids(jacks), jokerId]] })).toEqual({ ok: true });
    expect(await emit(first.socket, 'game:discard', { cardId: spare.id })).toEqual({ ok: true });
  });
});

describe('end of a round', () => {
  test('normal win: winner -20, a player who melded writes the hand value, one who did not +100', async () => {
    const game = await startGame(3);
    const [winner, melded, never] = game.players;
    game.gs().hasFirstMeld[String(winner.id)] = true;
    game.gs().hasFirstMeld[String(melded.id)] = true;
    const run = [card('7', 'spades'), card('8', 'spades'), card('9', 'spades')];
    const last = card('King', 'diamonds');
    setHand(game, winner, [...run, last]);
    setHand(game, melded, [card('5', 'clubs'), card('Queen', 'clubs'), card('Joker')]); // 5 + 10 + 15

    await emit(winner.socket, 'game:meld', { groups: [ids(run)] });
    const roundOver = waitFor(never.socket, 'game:roundOver');
    expect(await emit(winner.socket, 'game:discard', { cardId: last.id })).toEqual({ ok: true });
    const result = await roundOver;
    expect(result).toMatchObject({ round: 1, winnerId: String(winner.id), isGoOutFromHand: false });
    expect(result.scores).toEqual({ [winner.id]: -20, [melded.id]: 30, [never.id]: 100 });
  });

  test('handolás: winner -40, the others double or +200, and round 2 starts with the next player', async () => {
    const game = await startGame(2);
    const [winner, other] = game.players;
    const threes = [card('3', 'clubs'), card('3', 'diamonds'), card('3', 'hearts')];
    const last = card('9', 'spades');
    setHand(game, winner, [...threes, last]);

    // all but one card at once: the 51-point minimum does not apply
    expect(await emit(winner.socket, 'game:meld', { groups: [ids(threes)] })).toEqual({ ok: true });
    const roundOver = waitFor(other.socket, 'game:roundOver');
    await emit(winner.socket, 'game:discard', { cardId: last.id });
    const result = await roundOver;
    expect(result.isGoOutFromHand).toBe(true);
    expect(result.scores).toEqual({ [winner.id]: -40, [other.id]: 200 });

    // the next round is dealt after the round summary (6 s)
    const next = await waitFor(other.socket, 'game:state', 9000);
    expect(next.round).toBe(2);
    expect(next.players).toEqual([other.id, winner.id]);
    expect(next.hands[other.id]).toHaveLength(15);
  }, 15000);
});

describe('surrender', () => {
  test('with three players the game goes on without the one who gave up', async () => {
    const game = await startGame(3);
    const [first, second, third] = game.players;
    expect(await emit(first.socket, 'game:surrender')).toEqual({ ok: true });
    expect(game.gs().players[game.gs().turnIndex]).toBe(second.id); // it was their turn
    const seat = await db.GameUser.findOne({ where: { gameID: game.gameId, userID: first.id } });
    expect(seat.isSurrendered).toBe(true);
    expect(lastState(third.socket)).toBeDefined();
  });

  test('when only one player is left, they win the game', async () => {
    const game = await startGame(2);
    const [first, second] = game.players;
    const over = waitFor(second.socket, 'game:over');
    await emit(first.socket, 'game:surrender');
    expect(await over).toMatchObject({ winnerId: String(second.id), surrenderWin: true });
    const row = await db.Game.findByPk(game.gameId);
    expect(row.status).toBe('finished');
    expect(row.winnerID).toBe(second.id);
    expect(store.gameStates.has(game.gameId)).toBe(false);
  });

  test('a running game blocks account deletion until the player surrenders', async () => {
    const game = await startGame(2);
    const [first] = game.players;
    const del = () => server.request('DELETE', '/user', { token: first.token, body: { password: 'password1' } });
    expect(await del()).toEqual({ status: 409, body: { message: msg.ACTIVE_GAME } });
  });
});

describe('chat', () => {
  test('a message reaches everyone in the room and is stored', async () => {
    const { gameId, players: [a, b] } = await startGame(2);
    const incoming = waitFor(b.socket, 'chat:message');
    expect(await emit(a.socket, 'chat:send', { message: '  Szia!  ' })).toEqual({ ok: true });
    expect(await incoming).toMatchObject({ message: 'Szia!', user: { id: a.id, name: a.name } });
    expect(await db.Chat.count({ where: { gameID: gameId } })).toBe(1);
  });

  test('empty and too long messages are refused', async () => {
    const { players: [a] } = await startGame(2);
    expect(await emit(a.socket, 'chat:send', { message: '   ' })).toEqual({ error: msg.INVALID_CHAT_MESSAGE });
    expect(await emit(a.socket, 'chat:send', { message: 'x'.repeat(501) })).toEqual({ error: msg.INVALID_CHAT_MESSAGE });
  });

  test('a muted player cannot send messages', async () => {
    const { players: [a] } = await startGame(2);
    await db.User.update({ mutedUntil: new Date('2099-01-01') }, { where: { id: a.id } });
    expect(await emit(a.socket, 'chat:send', { message: 'hello' })).toEqual({ error: msg.MUTED });
  });

  test('outside a room there is nobody to send to', async () => {
    userCount += 1;
    const user = await server.register(`gamer${userCount}`);
    const socket = await server.connect(user);
    expect(await emit(socket, 'chat:send', { message: 'hello' })).toEqual({ error: msg.NOT_IN_ROOM });
  });

  test('a player who comes back gets the chat history', async () => {
    const { gameId, players: [a, b] } = await startGame(2);
    await emit(a.socket, 'chat:send', { message: 'first' });
    await emit(b.socket, 'chat:send', { message: 'second' });
    const reloaded = await server.connect(a);
    const joined = waitFor(reloaded, 'game:joined');
    await emit(reloaded, 'game:join', { gameId, password: null });
    expect((await joined).messages.map((m) => m.message)).toEqual(['first', 'second']);
  });
});
