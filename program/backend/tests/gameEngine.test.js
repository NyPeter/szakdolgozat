// Unit tests for the pure game rules in socket/gameEngine.js.
// Rule quotes come from dokumentacio/Játékszabály.txt.
const engine = require('../socket/gameEngine');

const {
  createDeck, shuffle, drawSwapCard, dealCards, initGameState, getPlayerView,
  isValidSet, isValidRun, isValidMeld, sortMeldCards, meldValueForMinimum,
  canSwapJokerInMeld, calculateRoundScores,
} = engine;

let nextId = 1000;
const VALUES = {
  Jack: 10, Queen: 10, King: 10, Ace: 11, Joker: 15,
};

// card('7', 'hearts'), card('Joker')
const card = (rank, suit = 'hearts') => ({
  id: nextId++,
  rank,
  suit: rank === 'Joker' ? null : suit,
  value: VALUES[rank] ?? parseInt(rank, 10),
});

// run('hearts', '5', '6', 'Joker') — every natural card in the same suit
const run = (suit, ...ranks) => ranks.map((r) => card(r, suit));

const ranksOf = (cards) => cards.map((c) => c.rank);
const isJoker = (c) => c.rank === 'Joker';

describe('createDeck', () => {
  test('2-4 players: 2 packs (104 cards) and 6 jokers', () => {
    [2, 3, 4].forEach((players) => {
      const deck = createDeck(players);
      expect(deck).toHaveLength(110);
      expect(deck.filter(isJoker)).toHaveLength(6);
    });
  });

  test('5-6 players: "3×52 lappal és 9 dzsókerrel"', () => {
    [5, 6].forEach((players) => {
      const deck = createDeck(players);
      expect(deck).toHaveLength(165);
      expect(deck.filter(isJoker)).toHaveLength(9);
    });
  });

  test('every card has a unique id', () => {
    const deck = createDeck(6);
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
  });

  test('card values: number = face value, J/Q/K = 10, Ace = 11, joker = 15', () => {
    const deck = createDeck(2);
    const valueOf = (rank) => deck.find((c) => c.rank === rank).value;
    expect(valueOf('2')).toBe(2);
    expect(valueOf('10')).toBe(10);
    expect(valueOf('Jack')).toBe(10);
    expect(valueOf('Queen')).toBe(10);
    expect(valueOf('King')).toBe(10);
    expect(valueOf('Ace')).toBe(11);
    expect(valueOf('Joker')).toBe(15);
  });

  test('each pack has every suit-rank pair once', () => {
    const deck = createDeck(2).filter((c) => !isJoker(c));
    const counts = {};
    deck.forEach((c) => { counts[`${c.rank}-${c.suit}`] = (counts[`${c.rank}-${c.suit}`] ?? 0) + 1; });
    expect(Object.keys(counts)).toHaveLength(52);
    expect(Object.values(counts).every((n) => n === 2)).toBe(true);
  });
});

describe('shuffle', () => {
  test('keeps exactly the same cards', () => {
    const deck = createDeck(2);
    const ids = deck.map((c) => c.id).sort((a, b) => a - b);
    const shuffled = shuffle([...deck]);
    expect(shuffled.map((c) => c.id).sort((a, b) => a - b)).toEqual(ids);
  });

  test('changes the order', () => {
    const deck = createDeck(2);
    const before = deck.map((c) => c.id).join();
    // The chance of a 110-card shuffle leaving the order unchanged is negligible.
    expect(shuffle([...deck]).map((c) => c.id).join()).not.toBe(before);
  });
});

describe('drawSwapCard', () => {
  afterEach(() => jest.restoreAllMocks());

  test('takes the top card (end of the array) when it is natural', () => {
    const deck = [card('2'), card('3'), card('King')];
    const swap = drawSwapCard(deck);
    expect(swap.rank).toBe('King');
    expect(ranksOf(deck)).toEqual(['2', '3']);
  });

  test('"Cserelapként az első természetes lap lesz felütve": a joker on top is skipped', () => {
    const deck = [card('2'), card('3'), card('Joker')];
    const swap = drawSwapCard(deck);
    expect(swap.rank).toBe('3');
    expect(deck).toHaveLength(2);
    expect(deck.filter(isJoker)).toHaveLength(1);
  });

  test('the joker can go back to the very bottom of the deck', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const deck = [card('2'), card('3'), card('4'), card('Joker')];
    drawSwapCard(deck);
    expect(deck[0].rank).toBe('Joker');
  });

  test('the joker never goes back on top, so it cannot be drawn again at once', () => {
    // The largest random value gives the highest allowed place: just below the
    // top card (the 4), which then becomes the swap card.
    jest.spyOn(Math, 'random').mockReturnValue(0.9999);
    const deck = [card('2'), card('3'), card('4'), card('Joker')];
    const swap = drawSwapCard(deck);
    expect(swap.rank).toBe('4');
    expect(ranksOf(deck)).toEqual(['2', '3', 'Joker']);
  });

  test('every joker on top: still a natural swap card, no card lost', () => {
    for (let t = 0; t < 200; t++) {
      const full = createDeck(5);
      const deck = [...full.filter((c) => !isJoker(c)), ...full.filter(isJoker)];
      const swap = drawSwapCard(deck);
      expect(isJoker(swap)).toBe(false);
      expect(deck).toHaveLength(full.length - 1);
      expect(deck.filter(isJoker)).toHaveLength(9);
    }
  });
});

describe('dealCards', () => {
  test('"A tőle jobbra ülő 15, a többiek 14-14 kártyát kapnak"', () => {
    const { hands } = dealCards(shuffle(createDeck(4)), [1, 2, 3, 4]);
    expect(hands[1]).toHaveLength(15);
    expect(hands[2]).toHaveLength(14);
    expect(hands[3]).toHaveLength(14);
    expect(hands[4]).toHaveLength(14);
  });

  test('hands + draw pile + swap card = the whole deck, no duplicates', () => {
    const deck = shuffle(createDeck(6));
    const total = deck.length;
    const { hands, drawPile, swapCard } = dealCards(deck, [1, 2, 3, 4, 5, 6]);
    const all = [...Object.values(hands).flat(), ...drawPile, swapCard];
    expect(all).toHaveLength(total);
    expect(new Set(all.map((c) => c.id)).size).toBe(total);
  });

  test('the swap card is never a joker', () => {
    for (let t = 0; t < 500; t++) {
      const { swapCard } = dealCards(shuffle(createDeck(3)), [1, 2, 3]);
      expect(isJoker(swapCard)).toBe(false);
    }
  });
});

describe('initGameState', () => {
  test('round 1 starts with the first player, round 2 with the second', () => {
    expect(initGameState([10, 20, 30], 1).players).toEqual([10, 20, 30]);
    expect(initGameState([10, 20, 30], 2).players).toEqual([20, 30, 10]);
    expect(initGameState([10, 20, 30], 4).players).toEqual([10, 20, 30]);
  });

  test('the starting player gets 15 cards and nobody has melded yet', () => {
    const gs = initGameState([10, 20], 2);
    expect(gs.hands[20]).toHaveLength(15);
    expect(gs.hands[10]).toHaveLength(14);
    expect(gs.turnIndex).toBe(0);
    expect(gs.phase).toBe('discard');
    expect(gs.isFirstTurn).toBe(true);
    expect(gs.melds).toEqual([]);
    expect(gs.discardPile).toEqual([]);
    expect(gs.hasFirstMeld).toEqual({ 10: false, 20: false });
    expect(gs.round).toBe(2);
  });
});

describe('getPlayerView', () => {
  const makeState = () => {
    const gs = initGameState([1, 2], 1);
    gs.discardPile = [card('5'), card('9')];
    gs.drawnCardId = gs.hands[1][0].id;
    return gs;
  };

  test('own hand is visible, the others only as a card count', () => {
    const gs = makeState();
    const view = getPlayerView(gs, 2);
    expect(view.hands[2]).toEqual(gs.hands[2]);
    expect(view.hands[1]).toEqual({ count: 15 });
  });

  test('"a dobó halomban senki sem turkálhat": only the top discard is sent', () => {
    const view = getPlayerView(makeState(), 1);
    expect(view.discardTop.rank).toBe('9');
    expect(view.discardCount).toBe(2);
    expect(view.discardPile).toBeUndefined();
  });

  test('the draw pile is sent as a count only', () => {
    const gs = makeState();
    const view = getPlayerView(gs, 1);
    expect(view.drawPile).toEqual({ remaining: gs.drawPile.length });
  });

  test('only the current player learns which card was drawn', () => {
    const gs = makeState();
    expect(getPlayerView(gs, 1).drawnCardId).toBe(gs.drawnCardId);
    expect(getPlayerView(gs, 2).drawnCardId).toBeNull();
  });
});

describe('isValidSet (csoport)', () => {
  test('3 or 4 cards of the same rank in different suits', () => {
    expect(isValidSet([card('8', 'hearts'), card('8', 'spades'), card('8', 'clubs')])).toBe(true);
    expect(isValidSet([card('Ace', 'diamonds'), card('Ace', 'hearts'), card('Ace', 'spades'), card('Ace', 'clubs')])).toBe(true);
  });

  test('"egy csoportban nem szerepelhet két azonos színű kártya"', () => {
    expect(isValidSet([card('8', 'hearts'), card('8', 'hearts'), card('8', 'clubs')])).toBe(false);
  });

  test('too short, too long or mixed ranks', () => {
    expect(isValidSet([card('8', 'hearts'), card('8', 'spades')])).toBe(false);
    expect(isValidSet([card('8', 'hearts'), card('8', 'spades'), card('8', 'clubs'), card('8', 'diamonds'), card('8', 'hearts')])).toBe(false);
    expect(isValidSet([card('8', 'hearts'), card('9', 'spades'), card('8', 'clubs')])).toBe(false);
  });

  test('one joker may substitute a card', () => {
    expect(isValidSet([card('King', 'hearts'), card('King', 'spades'), card('Joker')])).toBe(true);
    expect(isValidSet([card('King', 'hearts'), card('King', 'spades'), card('King', 'clubs'), card('Joker')])).toBe(true);
  });

  test('"két dzsóker szerepel egy sorozatban vagy csoportban" is not allowed', () => {
    expect(isValidSet([card('King', 'hearts'), card('Joker'), card('Joker')])).toBe(false);
    expect(isValidSet([card('Joker'), card('Joker'), card('Joker')])).toBe(false);
  });
});

describe('isValidRun (sor)', () => {
  test('3+ consecutive cards of the same suit', () => {
    expect(isValidRun(run('spades', '4', '5', '6'))).toBe(true);
    expect(isValidRun(run('hearts', '9', '10', 'Jack', 'Queen', 'King'))).toBe(true);
  });

  test('order of selection does not matter', () => {
    expect(isValidRun(run('spades', '6', '4', '5'))).toBe(true);
  });

  test('different suits, gaps, duplicates and short runs are invalid', () => {
    expect(isValidRun([card('4', 'spades'), card('5', 'hearts'), card('6', 'spades')])).toBe(false);
    expect(isValidRun(run('spades', '4', '5', '7'))).toBe(false);
    expect(isValidRun(run('spades', '4', '5', '5', '6'))).toBe(false);
    expect(isValidRun(run('spades', '4', '5'))).toBe(false);
  });

  test('one joker fills a gap or extends an end', () => {
    expect(isValidRun(run('hearts', '7', '8', 'Joker', '10'))).toBe(true);
    expect(isValidRun(run('hearts', '7', '8', 'Joker'))).toBe(true);
  });

  test('two jokers in a run are not allowed', () => {
    expect(isValidRun(run('hearts', '7', 'Joker', 'Joker'))).toBe(false);
    expect(isValidRun(run('hearts', '7', 'Joker', '9', 'Joker'))).toBe(false);
  });

  test('"ász, 2, 3, illetve a dáma, király, ász": the Ace is low or high', () => {
    expect(isValidRun(run('clubs', 'Ace', '2', '3'))).toBe(true);
    expect(isValidRun(run('clubs', 'Queen', 'King', 'Ace'))).toBe(true);
    expect(isValidRun(run('clubs', 'Ace', 'Joker', '3'))).toBe(true);
    expect(isValidRun(run('clubs', 'King', 'Ace', 'Joker'))).toBe(true); // only as Q-K-A
  });

  test('"vagy a 2, vagy a király mellett": no wrap-around through the Ace', () => {
    expect(isValidRun(run('clubs', 'King', 'Ace', '2'))).toBe(false);
    expect(isValidRun(run('clubs', 'Queen', 'King', 'Ace', '2'))).toBe(false);
    expect(isValidRun(run('clubs', 'King', 'Ace', 'Joker', '2'))).toBe(false);
    expect(isValidRun(run('clubs', 'Ace', '2', 'Joker', 'King'))).toBe(false);
  });

  test('the full suit is valid from A to K or from 2 to A, but not A to A', () => {
    const low = run('hearts', 'Ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King');
    const high = run('hearts', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace');
    expect(isValidRun(low)).toBe(true);
    expect(isValidRun(high)).toBe(true);
    expect(isValidRun([...high, card('Ace', 'hearts')])).toBe(false);
  });
});

describe('isValidMeld', () => {
  test('accepts sets and runs, rejects anything else', () => {
    expect(isValidMeld([card('8', 'hearts'), card('8', 'spades'), card('8', 'clubs')])).toBe(true);
    expect(isValidMeld(run('spades', '4', '5', '6'))).toBe(true);
    expect(isValidMeld([card('8', 'hearts'), card('9', 'spades'), card('Jack', 'clubs')])).toBe(false);
  });
});

describe('sortMeldCards', () => {
  test('set: ordered by suit, joker last', () => {
    const sorted = sortMeldCards([card('Joker'), card('8', 'spades'), card('8', 'clubs'), card('8', 'hearts')], 'set');
    expect(sorted.map((c) => c.suit)).toEqual(['clubs', 'hearts', 'spades', null]);
  });

  test.each([
    // [cards as selected, shown on the table]
    [['6', '4', '5'], ['4', '5', '6']],
    [['5', '7', 'Joker'], ['5', 'Joker', '7']],
    [['5', '6', 'Joker'], ['5', '6', 'Joker']],
    [['3', 'Joker', 'Ace'], ['Ace', 'Joker', '3']],
    [['Ace', 'Joker', '3', '4'], ['Ace', 'Joker', '3', '4']],
    [['Ace', '2', 'Joker'], ['Ace', '2', 'Joker']],
    [['Ace', '3', '2'], ['Ace', '2', '3']],
    [['Ace', 'King', 'Queen'], ['Queen', 'King', 'Ace']],
    [['Queen', 'Ace', 'Joker'], ['Queen', 'Joker', 'Ace']],
    [['King', 'Ace', 'Joker'], ['Joker', 'King', 'Ace']],
  ])('run %j is shown as %j', (selected, shown) => {
    expect(ranksOf(sortMeldCards(run('hearts', ...selected), 'run'))).toEqual(shown);
  });
});

describe('meldValueForMinimum', () => {
  test('without a joker: the sum of the card values', () => {
    expect(meldValueForMinimum(run('hearts', '10', 'Jack', 'Queen'))).toBe(30);
    expect(meldValueForMinimum([card('Ace', 'hearts'), card('Ace', 'spades'), card('Ace', 'clubs')])).toBe(33);
  });

  test('"a dzsókereket a helyettesített lap értékével számoljuk": in a set', () => {
    expect(meldValueForMinimum([card('King', 'hearts'), card('King', 'spades'), card('Joker')])).toBe(30);
    expect(meldValueForMinimum([card('7', 'hearts'), card('7', 'spades'), card('7', 'clubs'), card('Joker')])).toBe(28);
  });

  test('in a run the joker is worth the card it fills', () => {
    expect(meldValueForMinimum(run('hearts', '5', 'Joker', '7'))).toBe(18); // joker = 6
    expect(meldValueForMinimum(run('hearts', 'Ace', 'Joker', '3'))).toBe(16); // joker = 2
    expect(meldValueForMinimum(run('hearts', 'Joker', 'King', 'Ace'))).toBe(31); // joker = Q
  });

  test('a joker at an open end takes the higher-valued side', () => {
    expect(meldValueForMinimum(run('hearts', '5', '6', 'Joker'))).toBe(18); // 7, not 4
    expect(meldValueForMinimum(run('hearts', 'Queen', 'King', 'Joker'))).toBe(31); // Ace, not Jack
    expect(meldValueForMinimum(run('hearts', 'Ace', '2', 'Joker'))).toBe(16); // only 3 fits
  });
});

describe('canSwapJokerInMeld', () => {
  test('run: "kőr 7, kőr 8, dzsóker (kőr 9), kőr 10: a kőr 9 lerakásával szerezhető meg"', () => {
    const cards = run('hearts', '7', '8', 'Joker', '10');
    const meld = { type: 'run', cards };
    const jokerId = cards[2].id;
    expect(canSwapJokerInMeld(meld, card('9', 'hearts'), jokerId)).toBe(true);
    expect(canSwapJokerInMeld(meld, card('9', 'spades'), jokerId)).toBe(false);
    expect(canSwapJokerInMeld(meld, card('Jack', 'hearts'), jokerId)).toBe(false);
  });

  test('set: the joker can be taken by adding the fourth suit', () => {
    const cards = [card('5', 'spades'), card('5', 'clubs'), card('5', 'diamonds'), card('Joker')];
    const meld = { type: 'set', cards };
    expect(canSwapJokerInMeld(meld, card('5', 'hearts'), cards[3].id)).toBe(true);
    expect(canSwapJokerInMeld(meld, card('5', 'spades'), cards[3].id)).toBe(false);
    expect(canSwapJokerInMeld(meld, card('6', 'hearts'), cards[3].id)).toBe(false);
  });

  test('"Három lapos csoportból nem vehető fel a dzsóker!"', () => {
    const cards = [card('5', 'spades'), card('5', 'clubs'), card('Joker')];
    expect(canSwapJokerInMeld({ type: 'set', cards }, card('5', 'hearts'), cards[2].id)).toBe(false);
  });

  test('only a natural card can replace a joker, and only a joker can be replaced', () => {
    const cards = run('hearts', '7', '8', 'Joker');
    const meld = { type: 'run', cards };
    expect(canSwapJokerInMeld(meld, card('Joker'), cards[2].id)).toBe(false);
    expect(canSwapJokerInMeld(meld, card('9', 'hearts'), cards[0].id)).toBe(false);
  });
});

describe('calculateRoundScores', () => {
  // Player 1 wins; 2 has melded and holds 7 + King + joker (32);
  // 3 never laid anything down.
  const makeState = () => ({
    players: [1, 2, 3],
    hasFirstMeld: { 1: true, 2: true, 3: false },
    hands: {
      1: [],
      2: [card('7'), card('King'), card('Joker')],
      3: [card('2'), card('3')],
    },
  });

  test('normal win: winner -20, others their hand value, "+100" for no meld', () => {
    expect(calculateRoundScores(makeState(), 1, false, false)).toEqual({ 1: -20, 2: 32, 3: 100 });
  });

  test('a joker left in the hand is worth 15', () => {
    const gs = makeState();
    gs.hands[2] = [card('Joker')];
    expect(calculateRoundScores(gs, 1, false, false)[2]).toBe(15);
  });

  test('handolás: "a nyertes (-) 40 pontot ír, társai a kiszámolt pontok kétszeresét, illetve (+) 200"', () => {
    expect(calculateRoundScores(makeState(), 1, true, false)).toEqual({ 1: -40, 2: 64, 3: 200 });
  });

  test('"Szúró handnál nem érvényesül a kétszeres szabály, a nyertes is csak -20 pontot kap"', () => {
    expect(calculateRoundScores(makeState(), 1, true, true)).toEqual({ 1: -20, 2: 32, 3: 100 });
  });

  test('player ids may come as numbers or strings', () => {
    expect(calculateRoundScores(makeState(), '1', false, false)[1]).toBe(-20);
  });
});
