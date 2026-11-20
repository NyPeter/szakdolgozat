/* eslint-disable no-param-reassign */
/* eslint-disable object-curly-newline */
/* eslint-disable jsdoc/require-jsdoc */
// Dev-only game state presets for manual testing.
// Each function receives (gs, userId) and mutates gs in-place.
// Trigger from the browser console: socket.emit('game:devPreset', { preset: 'name' }, console.log)
// DELETE THIS FILE before production.

const PRESETS = {
  // ── handolás (go out from hand) ─────────────────────────────────────────────
  // Hand: [3♣ 3♦ 3♥]. Draw anything → 4 cards.
  // Lay the three 3s as a set (51pt min waived: 3 >= 4-1).
  // Discard the drawn card → handolás win.
  goOutFromHand(gs, userId) {
    gs.hands[userId] = [
      { id: 9900, suit: 'clubs', rank: '3', value: 3 },
      { id: 9901, suit: 'diamonds', rank: '3', value: 3 },
      { id: 9902, suit: 'hearts', rank: '3', value: 3 },
    ];
    gs.phase = 'draw';
  },

  // ── szúró hand (go out from hand with a lay-off) ────────────────────────────
  // Table gets a hearts run [8♥ 9♥ 10♥].
  // Hand: [J♣ J♦ J♠  Q♣ Q♦ Q♠  J♥]. Draw anything → 8 cards.
  // 1. Lay [J♣ J♦ J♠] + [Q♣ Q♦ Q♠] as two sets (60pts ≥ 51).
  // 2. Szúrás J♥ onto the hearts run.
  // 3. Discard the drawn card → szúró hand win (handolás + szúrás).
  goOutFromHandWithLayOff(gs, userId) {
    gs.melds.push({
      id: gs.meldCounter,
      playerId: 'dev',
      type: 'run',
      cards: [
        { id: 9910, suit: 'hearts', rank: '8', value: 8 },
        { id: 9911, suit: 'hearts', rank: '9', value: 9 },
        { id: 9912, suit: 'hearts', rank: '10', value: 10 },
      ],
    });
    gs.meldCounter += 1;
    gs.hands[userId] = [
      { id: 9900, suit: 'clubs', rank: 'Jack', value: 10 },
      { id: 9901, suit: 'diamonds', rank: 'Jack', value: 10 },
      { id: 9902, suit: 'spades', rank: 'Jack', value: 10 },
      { id: 9903, suit: 'clubs', rank: 'Queen', value: 10 },
      { id: 9904, suit: 'diamonds', rank: 'Queen', value: 10 },
      { id: 9905, suit: 'spades', rank: 'Queen', value: 10 },
      { id: 9906, suit: 'hearts', rank: 'Jack', value: 10 },
    ];
    gs.phase = 'draw';
  },

  // ── joker swap ──────────────────────────────────────────────────────────────
  // Table gets a 4-card set [3♣ 3♦ 3♥ Joker]. hasFirstMeld is pre-set.
  // Hand: [3♠  8♣ 9♣ 10♣  7♠ 5♥]. Already in discard phase.
  // 1. game:jokerSwap — replace the joker with 3♠; joker enters hand.
  // 2. game:meld [8♣ Joker 10♣] as a run (joker substitutes 9) — obligation cleared.
  // 3. Discard anything.
  jokerSwap(gs, userId) {
    gs.melds.push({
      id: gs.meldCounter,
      playerId: 'dev',
      type: 'set',
      cards: [
        { id: 9910, suit: 'clubs', rank: '3', value: 3 },
        { id: 9911, suit: 'diamonds', rank: '3', value: 3 },
        { id: 9912, suit: 'hearts', rank: '3', value: 3 },
        { id: 9913, suit: null, rank: 'Joker', value: 15 },
      ],
    });
    gs.meldCounter += 1;
    gs.hasFirstMeld[userId] = true;
    gs.hands[userId] = [
      { id: 9900, suit: 'spades', rank: '3', value: 3 },
      { id: 9901, suit: 'clubs', rank: '8', value: 8 },
      { id: 9902, suit: 'clubs', rank: '9', value: 9 },
      { id: 9903, suit: 'clubs', rank: '10', value: 10 },
      { id: 9904, suit: 'spades', rank: '7', value: 7 },
      { id: 9905, suit: 'hearts', rank: '5', value: 5 },
    ];
    gs.phase = 'discard';
  },

  // ── cserelap (swap card) exchange (role 1) ───────────────────────────────────
  // Swap card = A♠. Already in discard phase, inside the first draw round
  // (the only time the exchange is allowed).
  // Select one card → game:exchangeSwapCard → trade it for the Ace.
  // Still need to discard after the exchange.
  swapCardExchange(gs, userId) {
    gs.isFirstTurn = true;
    gs.swapCard = { id: 9920, suit: 'spades', rank: 'Ace', value: 11 };
    gs.hands[userId] = [
      { id: 9900, suit: 'clubs', rank: 'King', value: 10 },
      { id: 9901, suit: 'diamonds', rank: 'Queen', value: 10 },
      { id: 9902, suit: 'hearts', rank: 'Jack', value: 10 },
      { id: 9903, suit: 'clubs', rank: '9', value: 9 },
      { id: 9904, suit: 'spades', rank: '7', value: 7 },
      { id: 9905, suit: 'hearts', rank: '2', value: 2 },
    ];
    gs.phase = 'discard';
  },

  // ── cserelap (swap card) as the last card for handolás (role 2) ──────────────
  // Swap card = 3♥. Hand: [3♣ 3♦ 7♠]. In draw phase.
  // game:draw source='swapCard' → hand becomes [3♣ 3♦ 7♠ 3♥], swapCardDrawn set.
  // Lay [3♣ 3♦ 3♥] as set (min waived: 3 >= 4-1).
  // Discard 7♠ → handolás win.
  swapCardGoOut(gs, userId) {
    gs.swapCard = { id: 9920, suit: 'hearts', rank: '3', value: 3 };
    gs.hands[userId] = [
      { id: 9900, suit: 'clubs', rank: '3', value: 3 },
      { id: 9901, suit: 'diamonds', rank: '3', value: 3 },
      { id: 9902, suit: 'spades', rank: '7', value: 7 },
    ];
    gs.phase = 'draw';
  },
};

module.exports = PRESETS;
