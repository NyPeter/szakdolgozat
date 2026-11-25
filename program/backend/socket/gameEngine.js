// Game terms: the code uses English names for the Hungarian rummy terms.
//   swapCard      – cserelap (handlap): the face-up card under the deck
//   goOutFromHand – handolás: going out in one turn straight from the hand
//                   ("kézből történő befejezés"), without an earlier meld
//   layOff        – szúrás: adding a card from the hand to a meld on the table

// Index 0 = '2', index 12 = 'Ace'. In A-2-3 runs the Ace is treated as index -1.
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

/**
 * Builds an unshuffled deck: 2 packs for 2-4 players, 3 packs for 5-6,
 * with 3 jokers per pack. Card ids are unique within the deck.
 *
 * @param {number} playerCount - Number of players.
 * @returns {Array<object>} Cards as `{ id, suit, rank, value }`.
 */
function createDeck(playerCount) {
  const deckCount = playerCount < 5 ? 2 : 3;
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];
  const deck = [];
  for (let i = 0; i < deckCount; i++) {
    for (const suit of suits) {
      for (const rank of ranks) {
        if (rank === 'Jack' || rank === 'Queen' || rank === 'King') {
          deck.push({ id: deck.length, suit, rank, value: 10 });
        } else if (rank === 'Ace') {
          deck.push({ id: deck.length, suit, rank, value: 11 });
        } else {
          deck.push({ id: deck.length, suit, rank, value: parseInt(rank, 10) });
        }
      }
    }
  }
  for (let i = 0; i < deckCount * 3; i++) {
    deck.push({ id: deck.length, suit: null, rank: 'Joker', value: 15 });
  }
  return deck;
}

/**
 * Fisher-Yates shuffle, in place.
 *
 * @param {Array<object>} deck - Cards to shuffle.
 * @returns {Array<object>} The same array, shuffled.
 */
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // eslint-disable-next-line no-param-reassign -- shuffles the given array in place
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Takes the swap card from the top of the deck (the end of the array, where
 * draws come from too). It must be a natural card ("Cserelapként az első
 * természetes lap lesz felütve"): a joker goes back to a random place in the
 * deck, anywhere below the current top card (down to the very bottom).
 *
 * @param {Array<object>} deck - Shuffled deck, changed in place.
 * @returns {object} The swap card.
 */
function drawSwapCard(deck) {
  let card = deck.pop();
  while (card.rank === 'Joker') {
    // An index in 0 … length - 1 inserts before an existing card, so never on top.
    deck.splice(Math.floor(Math.random() * deck.length), 0, card);
    card = deck.pop();
  }
  return card;
}

/**
 * Turns up the swap card, then deals 15 cards to the first player and 14 to the others.
 *
 * @param {Array<object>} deck - Shuffled deck, changed in place.
 * @param {Array<string>} playerIds - Players in turn order.
 * @returns {object} `{ hands, drawPile, swapCard }`, hands keyed by player id.
 */
function dealCards(deck, playerIds) {
  const swapCard = drawSwapCard(deck);
  const hands = {};
  playerIds.forEach((id, index) => {
    const count = index === 0 ? 15 : 14;
    hands[id] = deck.splice(0, count);
  });
  return { hands, drawPile: deck, swapCard };
}

/**
 * Creates the state of a new round. The starting player moves one seat on
 * every round; the first player starts with 15 cards, in the discard phase.
 *
 * @param {Array<string>} playerIds - Active players in seat order.
 * @param {number} roundNumber - Round number, from 1.
 * @returns {object} The game state.
 */
function initGameState(playerIds, roundNumber) {
  const startIndex = (roundNumber - 1) % playerIds.length;
  const rotated = [
    ...playerIds.slice(startIndex),
    ...playerIds.slice(0, startIndex),
  ];

  const deck = shuffle(createDeck(playerIds.length));
  const { hands, drawPile, swapCard } = dealCards(deck, rotated);

  return {
    players: rotated,
    turnIndex: 0,
    phase: 'discard',
    hands,
    drawPile,
    discardPile: [],
    swapCard,
    isFirstTurn: true,
    discardDrawnCard: null,
    // Where the current player drew from this turn: 'deck' | 'discard' | 'swapCard' | null.
    drawSource: null,
    // Id of the card drawn this turn, so the drawer's client can mark it.
    drawnCardId: null,
    melds: [],
    meldCounter: 0,
    // A joker taken from a table meld this turn. It must be laid down again
    // before the player may discard.
    swappedJoker: null,
    swapCardDrawn: null,
    // The player who made their first meld this turn. If they also go out this
    // turn, it is a handolás.
    firstMeldTurnPlayer: null,
    usedLayOffThisTurn: false,
    // Per player: handolás signalled this turn. Allows szúrás on the first-meld
    // turn; cancelling it takes those szúrás back (layOffHistory).
    goOutFromHandBid: Object.fromEntries(rotated.map((id) => [id, false])),
    layOffHistory: [],
    round: roundNumber,
    hasFirstMeld: Object.fromEntries(rotated.map((id) => [id, false])),
  };
}

/**
 * The part of the game state one player may see: their own hand, only the
 * card count of the others' hands, and only the top of the discard pile.
 *
 * @param {object} gameState - Full game state.
 * @param {string|number} userId - The viewing player.
 * @returns {object} The player's view.
 */
function getPlayerView(gameState, userId) {
  const hands = {};
  for (const [id, cards] of Object.entries(gameState.hands)) {
    hands[id] = String(id) === String(userId) ? cards : { count: cards.length };
  }

  // "A dobó halomban senki sem turkálhat": only the top card is sent.
  const { discardPile } = gameState;
  return {
    players: gameState.players,
    turnIndex: gameState.turnIndex,
    phase: gameState.phase,
    round: gameState.round,
    turnTimerStartedAt: gameState.turnTimerStartedAt,
    hands,
    drawPile: { remaining: gameState.drawPile.length },
    discardTop: discardPile.length > 0 ? discardPile[discardPile.length - 1] : null,
    discardCount: discardPile.length,
    swapCard: gameState.swapCard,
    melds: gameState.melds,
    isFirstTurn: gameState.isFirstTurn,
    hasFirstMeld: gameState.hasFirstMeld,
    firstMeldTurnPlayer: gameState.firstMeldTurnPlayer,
    goOutFromHandBid: gameState.goOutFromHandBid,
    discardDrawnCard: gameState.discardDrawnCard,
    swapCardDrawn: gameState.swapCardDrawn,
    swappedJoker: gameState.swappedJoker,
    // A card drawn from the deck is hidden information: only the drawer learns
    // which card in their hand is the new one.
    drawnCardId: String(gameState.players[gameState.turnIndex]) === String(userId)
      ? gameState.drawnCardId
      : null,
  };
}

/**
 * Whether natural cards at the given rank indices, plus jokers in the missing
 * places, can form a run of exactly totalLen consecutive ranks. It looks for a
 * window [start, start + totalLen - 1] that holds every natural card and stays
 * inside the rank range: 0 … 12 with a high Ace, -1 … 11 with a low Ace.
 *
 * @param {Array<number>} rankIndices - RANK_ORDER indices of the natural cards.
 * @param {number} totalLen - Number of cards in the run, jokers included.
 * @param {boolean} lowAce - True when the Ace is index -1 (A-2-3).
 * @returns {boolean} True when such a run exists.
 */
function canFormRun(rankIndices, totalLen, lowAce) {
  if (new Set(rankIndices).size !== rankIndices.length) return false;

  const minIdx = Math.min(...rankIndices);
  const maxIdx = Math.max(...rankIndices);
  const span = maxIdx - minIdx + 1;
  if (span > totalLen) return false;

  const lo = lowAce ? -1 : 0;
  const hi = lowAce ? 11 : 12;
  if (totalLen > hi - lo + 1) return false;

  // The window must start at or below the lowest natural card, and end at or
  // above the highest one, without leaving [lo, hi].
  const minStart = Math.max(lo, maxIdx - totalLen + 1);
  const maxStart = Math.min(minIdx, hi - totalLen + 1);
  return minStart <= maxStart;
}

/**
 * A set: 3-4 cards of the same rank and different suits ("egy csoportban nem
 * szerepelhet két azonos színű kártya"), with at most one joker.
 *
 * @param {Array<object>} cards - The group.
 * @returns {boolean} True when it is a valid set.
 */
function isValidSet(cards) {
  if (cards.length < 3 || cards.length > 4) return false;
  const jokers = cards.filter((c) => c.rank === 'Joker');
  if (jokers.length > 1) return false;
  const natural = cards.filter((c) => c.rank !== 'Joker');
  if (natural.length === 0) return false;
  const { rank } = natural[0];
  if (!natural.every((c) => c.rank === rank)) return false;
  const suits = natural.map((c) => c.suit);
  return new Set(suits).size === natural.length;
}

/**
 * A run: 3 or more consecutive ranks of one suit, with at most one joker in a
 * missing place. The Ace is either low (A-2-3) or high (Q-K-A), never both,
 * so K-A-2 is not a run.
 *
 * @param {Array<object>} cards - The group.
 * @returns {boolean} True when it is a valid run.
 */
function isValidRun(cards) {
  if (cards.length < 3) return false;
  const jokers = cards.filter((c) => c.rank === 'Joker');
  if (jokers.length > 1) return false;
  const natural = cards.filter((c) => c.rank !== 'Joker');
  if (natural.length === 0) return false;

  const { suit } = natural[0];
  if (!suit) return false;
  if (!natural.every((c) => c.suit === suit)) return false;

  const highIndices = natural.map((c) => RANK_ORDER.indexOf(c.rank));
  if (canFormRun(highIndices, cards.length, false)) return true;

  if (natural.some((c) => c.rank === 'Ace')) {
    const lowIndices = highIndices.map((i) => (i === 12 ? -1 : i));
    if (canFormRun(lowIndices, cards.length, true)) return true;
  }

  return false;
}

/**
 * @param {Array<object>} cards - The group.
 * @returns {boolean} True when it is a valid set or a valid run.
 */
function isValidMeld(cards) {
  return isValidSet(cards) || isValidRun(cards);
}

const SUIT_ORDER = ['clubs', 'diamonds', 'hearts', 'spades'];

/**
 * Orders a meld for display.
 * Set: by suit (clubs, diamonds, hearts, spades), the joker last.
 * Run: by rank, the Ace low only when the run is valid only that way. The joker
 * goes into the gap between the natural cards; without a gap it goes to the high
 * end, or to the low end when the run already ends with the Ace.
 *
 * @param {Array<object>} cards - A valid meld.
 * @param {string} type - 'set' or 'run'.
 * @returns {Array<object>} A new, ordered array.
 */
function sortMeldCards(cards, type) {
  const jokers = cards.filter((c) => c.rank === 'Joker');
  const natural = cards.filter((c) => c.rank !== 'Joker');

  if (type === 'set') {
    const sorted = [...natural].sort(
      (a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit),
    );
    return [...sorted, ...jokers];
  }

  // Checking for a 2 is not enough: in A-Joker-3 the joker stands for the 2.
  const hasAce = natural.some((c) => c.rank === 'Ace');
  const highIndices = natural.map((c) => RANK_ORDER.indexOf(c.rank));
  const lowAce = hasAce && !canFormRun(highIndices, cards.length, false);
  const getIdx = (c) => (lowAce && c.rank === 'Ace' ? -1 : RANK_ORDER.indexOf(c.rank));

  const sorted = [...natural].sort((a, b) => getIdx(a) - getIdx(b));
  if (jokers.length === 0) return sorted;

  let insertAt = sorted.length;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (getIdx(sorted[i + 1]) - getIdx(sorted[i]) > 1) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt === sorted.length && sorted.length > 0
    && sorted[sorted.length - 1].rank === 'Ace' && !lowAce) {
    insertAt = 0;
  }

  const result = [...sorted];
  result.splice(insertAt, 0, jokers[0]);
  return result;
}

/**
 * Point value of a meld for the 51-point first-meld minimum. A joker counts as
 * the card it stands for ("a dzsókereket a helyettesített lap értékével
 * számoljuk"), not 15. In a run where it could stand at either end, the higher
 * value is used, which favours the player.
 *
 * @param {Array<object>} cards - A valid meld.
 * @returns {number} The points.
 */
function meldValueForMinimum(cards) {
  const natural = cards.filter((c) => c.rank !== 'Joker');
  const naturalValue = natural.reduce((sum, c) => sum + c.value, 0);
  if (!cards.some((c) => c.rank === 'Joker')) return naturalValue;

  if (isValidSet(cards)) {
    return naturalValue + natural[0].value;
  }

  // Run: the best joker value with a high and with a low Ace.
  const findJokerValue = (lowAce) => {
    const getIdx = (c) => (c.rank === 'Ace' && lowAce ? -1 : RANK_ORDER.indexOf(c.rank));
    const indices = natural.map(getIdx);
    if (!canFormRun(indices, cards.length, lowAce)) return -1;

    const sorted = [...indices].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const naturalSet = new Set(indices);
    const lo = lowAce ? -1 : 0;
    const hi = lowAce ? 11 : 12;

    // The gap between the natural cards, or without a gap, either end.
    const candidates = [];
    for (let i = min; i <= max; i += 1) {
      if (!naturalSet.has(i)) candidates.push(i);
    }
    if (candidates.length === 0) {
      if (min > lo) candidates.push(min - 1);
      if (max < hi) candidates.push(max + 1);
    }

    const indexToValue = (idx) => {
      if (idx === -1 || idx === 12) return 11;
      const rank = RANK_ORDER[idx];
      if (rank === 'Jack' || rank === 'Queen' || rank === 'King') return 10;
      return parseInt(rank, 10);
    };

    return candidates.length > 0 ? Math.max(...candidates.map(indexToValue)) : 0;
  };

  const highVal = findJokerValue(false);
  const lowVal = natural.some((c) => c.rank === 'Ace') ? findJokerValue(true) : -1;
  return naturalValue + Math.max(highVal, lowVal, 0);
}

/**
 * Whether naturalCard may replace the joker in a table meld.
 * Run: the run must stay valid with the card in the joker's place.
 * Set: the set must already have 3 natural cards ("három lapos csoportból nem
 * vehető fel a dzsóker"), and the card must have their rank and a new suit.
 *
 * @param {object} meld - Table meld `{ type, cards }`.
 * @param {object} naturalCard - Card from the player's hand.
 * @param {number} jokerId - Id of the joker in the meld.
 * @returns {boolean} True when the swap is allowed.
 */
function canSwapJokerInMeld(meld, naturalCard, jokerId) {
  const joker = meld.cards.find((c) => c.id === jokerId);
  if (!joker || joker.rank !== 'Joker') return false;
  if (naturalCard.rank === 'Joker') return false;

  const naturalInMeld = meld.cards.filter((c) => c.rank !== 'Joker');

  if (meld.type === 'set') {
    if (naturalInMeld.length < 3) return false;
    if (naturalCard.rank !== naturalInMeld[0].rank) return false;
    if (naturalInMeld.some((c) => c.suit === naturalCard.suit)) return false;
    return true;
  }

  const newCards = meld.cards.map((c) => (c.id === jokerId ? naturalCard : c));
  return isValidRun(newCards);
}

/**
 * Points of a finished round (lower is better):
 *
 *   Normal win:   winner -20, players who laid down: hand value, the others: 100
 *   Handolás:     winner -40, players who laid down: 2 × hand value, the others: 200
 *   Szúró hand:   scored as a normal win (handolás with szúrás in the same turn)
 *
 * Hand values: number cards their face value, J/Q/K 10, Ace 11, Joker 15.
 *
 * @param {object} gs - Game state at the end of the round.
 * @param {string} winnerId - The player who went out.
 * @param {boolean} isGoOutFromHand - The winner went out with handolás.
 * @param {boolean} isGoOutFromHandWithLayOff - ... and laid off in that turn.
 * @returns {object} Points by player id.
 */
function calculateRoundScores(gs, winnerId, isGoOutFromHand, isGoOutFromHandWithLayOff) {
  const scores = {};
  const winner = String(winnerId);
  const doubles = isGoOutFromHand && !isGoOutFromHandWithLayOff;
  for (const playerId of gs.players) {
    const strId = String(playerId);
    if (strId === winner) {
      scores[strId] = doubles ? -40 : -20;
    } else {
      const neverLaid = !gs.hasFirstMeld[strId];
      if (neverLaid) {
        scores[strId] = doubles ? 200 : 100;
      } else {
        const hand = gs.hands[strId] || [];
        const handValue = hand.reduce((sum, c) => sum + c.value, 0);
        scores[strId] = doubles ? handValue * 2 : handValue;
      }
    }
  }
  return scores;
}

module.exports = {
  createDeck,
  dealCards,
  drawSwapCard,
  initGameState,
  getPlayerView,
  shuffle,
  isValidMeld,
  isValidSet,
  isValidRun,
  meldValueForMinimum,
  sortMeldCards,
  canSwapJokerInMeld,
  calculateRoundScores,
};
