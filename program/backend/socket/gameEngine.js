/* eslint-disable object-curly-newline */
/* eslint-disable jsdoc/require-jsdoc */
/* eslint-disable no-param-reassign */

// Game terms: the code uses English names for the Hungarian rummy terms.
//   swapCard      – cserelap (handlap): the face-up card under the deck
//   goOutFromHand – handolás: going out in one turn straight from the hand
//                   ("kézből történő befejezés"), without an earlier meld
//   layOff        – szúrás: adding a card from the hand to a meld on the table

// Canonical rank sequence: index 0 = '2', index 12 = 'Ace' (high position).
// For A-2-3 runs, Ace is temporarily treated as index -1 (see canFormRun).
const RANK_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

function createDeck(playerCount) {
  const deckCount = playerCount < 5 ? 2 : 3;
  const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];
  const deck = [];
  for (let i = 0; i < deckCount; i++) {
    // eslint-disable-next-line no-restricted-syntax
    for (const suit of suits) {
      // eslint-disable-next-line no-restricted-syntax
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

// Fisher-Yates shuffle
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// The swap card is taken from the top of the deck (the end of the array, where
// draws come from too). It must be a natural card ("Cserelapként az első
// természetes lap lesz felütve"): a joker goes back to a random place in the
// deck, anywhere below the current top card (down to the very bottom).
function drawSwapCard(deck) {
  let card = deck.pop();
  while (card.rank === 'Joker') {
    // An index in 0 … length - 1 inserts before an existing card, so never on top.
    deck.splice(Math.floor(Math.random() * deck.length), 0, card);
    card = deck.pop();
  }
  return card;
}

function dealCards(deck, playerIds) {
  const swapCard = drawSwapCard(deck);
  const hands = {};
  playerIds.forEach((id, index) => {
    const count = index === 0 ? 15 : 14;
    hands[id] = deck.splice(0, count);
  });
  return { hands, drawPile: deck, swapCard };
}

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
    // Auto-increment counter used to assign stable IDs to each laid meld.
    meldCounter: 0,
    // Tracks a joker taken from a table meld via szúrás. It must be immediately
    // placed into another meld or szúrás this turn before the player may discard.
    swappedJoker: null,
    swapCardDrawn: null,
    // Set to the userId who first laid their game-first meld THIS turn (cleared on turn advance).
    // Used to detect handolás: if the winner's
    // firstMeldTurnPlayer matches, they went out in one shot.
    firstMeldTurnPlayer: null,
    // Set to true the first time game:layOff is called in the current turn (cleared on advance).
    usedLayOffThisTurn: false,
    // Per-player flag: true when the player declared a handolás finish intention this turn.
    // Enables szúrás on the first-meld turn. Cleared (with revert) via game:goOutFromHandBid.
    goOutFromHandBid: Object.fromEntries(rotated.map((id) => [id, false])),
    // Ordered log of szúrás ops made under the handolás bid this turn, used for revert.
    layOffHistory: [],
    round: roundNumber,
    hasFirstMeld: Object.fromEntries(rotated.map((id) => [id, false])),
  };
}

function getPlayerView(gameState, userId) {
  const hands = {};
  // eslint-disable-next-line no-restricted-syntax
  for (const [id, cards] of Object.entries(gameState.hands)) {
    hands[id] = String(id) === String(userId) ? cards : { count: cards.length };
  }

  // Only what a player is allowed to see is listed here. The discard pile is
  // reduced to its top card ("a dobó halomban senki sem turkálhat").
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

// ── Meld validation ──────────────────────────────────────────────────────────

// Checks whether a set of rank indices (natural cards only) plus joker gap-fills
// can form a legal consecutive run of exactly totalLen cards.
//
// lowAce = true  → Ace is at position -1 (for A-2-3 sequences)
// lowAce = false → Ace is at position 12 (for Q-K-A sequences)
//
// The algorithm finds whether a valid window [start, start+totalLen-1] exists
// that contains all natural-card positions and stays within the rank floor/ceiling.
function canFormRun(rankIndices, totalLen, lowAce) {
  // Duplicate rank positions are forbidden in a single run.
  if (new Set(rankIndices).size !== rankIndices.length) return false;

  const minIdx = Math.min(...rankIndices);
  const maxIdx = Math.max(...rankIndices);
  // Span: number of rank slots already used by natural cards (contiguous or with gaps).
  const span = maxIdx - minIdx + 1;
  // Jokers must fill the remaining slots; the natural span cannot exceed the total length.
  if (span > totalLen) return false;

  // Legal index space for the chosen ace orientation:
  //   high-ace: [0 … 12]   low-ace: [-1 … 11]
  const lo = lowAce ? -1 : 0;
  const hi = lowAce ? 11 : 12;
  if (totalLen > hi - lo + 1) return false; // run longer than available ranks

  // A starting index 'start' is valid when:
  //   all natural cards fall inside [start, start + totalLen - 1]
  //   the window itself stays inside [lo, hi]
  const minStart = Math.max(lo, maxIdx - totalLen + 1);
  const maxStart = Math.min(minIdx, hi - totalLen + 1);
  return minStart <= maxStart;
}

// isValidSet: a group of 3-4 cards with the same rank, all different suits, and at
// most one joker. The rule "egy csoportban nem szerepelhet két azonos színű kártya"
// (no two same-suit cards in a group) is enforced on the natural cards.
function isValidSet(cards) {
  if (cards.length < 3 || cards.length > 4) return false;
  const jokers = cards.filter((c) => c.rank === 'Joker');
  if (jokers.length > 1) return false; // only one joker per meld
  const natural = cards.filter((c) => c.rank !== 'Joker');
  if (natural.length === 0) return false;
  const { rank } = natural[0];
  if (!natural.every((c) => c.rank === rank)) return false; // all same rank
  const suits = natural.map((c) => c.suit);
  return new Set(suits).size === natural.length; // all different suits
}

// isValidRun: a sequence of 3+ consecutive-rank cards of the same suit with at most
// one joker filling any missing position. Ace can be low (A-2-3) or high (Q-K-A);
// wrap-arounds like K-A-2 are forbidden (checked implicitly by canFormRun).
function isValidRun(cards) {
  if (cards.length < 3) return false;
  const jokers = cards.filter((c) => c.rank === 'Joker');
  if (jokers.length > 1) return false;
  const natural = cards.filter((c) => c.rank !== 'Joker');
  if (natural.length === 0) return false;

  // All natural cards must share the same suit.
  const { suit } = natural[0];
  if (!suit) return false;
  if (!natural.every((c) => c.suit === suit)) return false;

  // Map to numeric rank indices for gap arithmetic.
  const highIndices = natural.map((c) => RANK_ORDER.indexOf(c.rank));

  // Try the standard (high-Ace at 12) orientation.
  if (canFormRun(highIndices, cards.length, false)) return true;

  // Also try low-Ace at -1 when the group contains an Ace.
  if (natural.some((c) => c.rank === 'Ace')) {
    const lowIndices = highIndices.map((i) => (i === 12 ? -1 : i));
    if (canFormRun(lowIndices, cards.length, true)) return true;
  }

  return false;
}

// isValidMeld: a card group is a legal meld if it is either a valid set or a valid run.
function isValidMeld(cards) {
  return isValidSet(cards) || isValidRun(cards);
}

// ── Display ordering ─────────────────────────────────────────────────────────

const SUIT_ORDER = ['clubs', 'diamonds', 'hearts', 'spades'];

// sortMeldCards: returns the cards in the canonical left-to-right display order.
//
//   Set  → sorted by suit (clubs → diamonds → hearts → spades); joker appended
//          at the end since it substitutes an unspecified suit.
//   Run  → sorted ascending by rank. The Ace is low (A-2-3…, A-Joker-3) when the
//          run is only valid that way (see isValidRun). The joker is inserted at the one
//          gap between natural cards; if there is no internal gap (all naturals
//          are already consecutive), it is appended at the high end.
function sortMeldCards(cards, type) {
  const jokers = cards.filter((c) => c.rank === 'Joker');
  const natural = cards.filter((c) => c.rank !== 'Joker');

  if (type === 'set') {
    const sorted = [...natural].sort(
      (a, b) => SUIT_ORDER.indexOf(a.suit) - SUIT_ORDER.indexOf(b.suit),
    );
    return [...sorted, ...jokers];
  }

  // Run: the Ace is low when the run cannot be formed with a high Ace.
  // (Checking for a 2 is not enough: in A-Joker-3 the joker stands for the 2.)
  const hasAce = natural.some((c) => c.rank === 'Ace');
  const highIndices = natural.map((c) => RANK_ORDER.indexOf(c.rank));
  const lowAce = hasAce && !canFormRun(highIndices, cards.length, false);
  const getIdx = (c) => (lowAce && c.rank === 'Ace' ? -1 : RANK_ORDER.indexOf(c.rank));

  const sorted = [...natural].sort((a, b) => getIdx(a) - getIdx(b));
  if (jokers.length === 0) return sorted;

  // Find the insertion point for the joker: the first internal gap between
  // two consecutive natural cards. If no gap exists, the joker goes before the
  // first card when the run ends on Ace (nothing above Ace), otherwise after.
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

// ── Meld value for first-meld minimum ────────────────────────────────────────

// meldValueForMinimum: returns the total point value of a meld for the 51-point
// first-meld minimum check.
//
// Natural cards use their face value. A joker counts as the value of the card
// it substitutes (rule: "a dzsókereket a helyettesített lap értékével számoljuk").
//   Set: joker substitutes the same rank → same face value as the other cards.
//   Run: joker occupies the one missing/extension rank slot. When two slots are
//        possible (both ends can extend), we use the higher-valued option,
//        which is the most favourable interpretation for the player.
//
// The joker's hand value (15 pts) is only relevant for end-of-round scoring and
// is NOT used here.
function meldValueForMinimum(cards) {
  const natural = cards.filter((c) => c.rank !== 'Joker');
  const naturalValue = natural.reduce((sum, c) => sum + c.value, 0);
  if (!cards.some((c) => c.rank === 'Joker')) return naturalValue;

  if (isValidSet(cards)) {
    // All natural cards share the same rank, so the joker value equals theirs.
    return naturalValue + natural[0].value;
  }

  // Run: try both Ace orientations, return the highest achievable joker value.
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

    // Collect the rank slot(s) not covered by natural cards.
    const candidates = [];
    for (let i = min; i <= max; i += 1) {
      if (!naturalSet.has(i)) candidates.push(i);
    }
    // No internal gap → joker can extend at either end.
    if (candidates.length === 0) {
      if (min > lo) candidates.push(min - 1);
      if (max < hi) candidates.push(max + 1);
    }

    const indexToValue = (idx) => {
      if (idx === -1 || idx === 12) return 11; // Ace
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

// canSwapJokerInMeld: returns true when naturalCard can legally replace the joker
// (identified by jokerId) in a table meld, following the szúrás-joker rules:
//
//   Run  → replacing the joker must leave the run structurally valid.
//   Set  → the set must already contain ≥3 natural cards (rule: "három lapos
//           csoportból nem vehető fel a dzsóker"), and naturalCard must match
//           the rank and introduce a suit not already present in the set.
function canSwapJokerInMeld(meld, naturalCard, jokerId) {
  const joker = meld.cards.find((c) => c.id === jokerId);
  if (!joker || joker.rank !== 'Joker') return false;
  if (naturalCard.rank === 'Joker') return false; // only a natural card may replace a joker

  const naturalInMeld = meld.cards.filter((c) => c.rank !== 'Joker');

  if (meld.type === 'set') {
    // Must have 3+ natural cards already so the set remains complete after the swap.
    if (naturalInMeld.length < 3) return false;
    if (naturalCard.rank !== naturalInMeld[0].rank) return false;
    if (naturalInMeld.some((c) => c.suit === naturalCard.suit)) return false;
    return true;
  }

  // Run: replace the joker slot and re-validate.
  const newCards = meld.cards.map((c) => (c.id === jokerId ? naturalCard : c));
  return isValidRun(newCards);
}

// ── Round scoring ────────────────────────────────────────────────────────────
//
// Scoring rules (from the official rules document):
//
//   Normal win:    winner = -20;  layers = hand value;  non-layers = +100 flat
//   Handolás win:  winner = -40;  layers = 2× hand value;  non-layers = +200 flat
//   Szúró hand:    same as normal win (winner = -20, no doubling)
//     (szúró hand = handolás where the winner also used szúrás this turn)
//
// "Non-layer" = player who never successfully laid a meld this entire round
// (hasFirstMeld[id] is still false when the round ends).
// Non-layers write a flat penalty that replaces the hand-value calculation.
// Hand card values: number cards face value, J/Q/K = 10, Ace = 11, Joker = 15.
function calculateRoundScores(gs, winnerId, isGoOutFromHand, isGoOutFromHandWithLayOff) {
  const scores = {};
  const winner = String(winnerId);
  const doubles = isGoOutFromHand && !isGoOutFromHandWithLayOff;
  // eslint-disable-next-line no-restricted-syntax
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
