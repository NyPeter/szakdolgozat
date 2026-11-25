// Dev-only game state presets for manual testing. Each one receives (gs, userId)
// and changes gs in place. From the browser console, on your turn:
//   window._socket.emit('game:devPreset', { preset: 'name' }, console.log)
// gameHandlers.js does not load this file when NODE_ENV=production.

const PRESETS = {
  /**
   * Handolás. Hand: [3♣ 3♦ 3♥]. Draw anything (4 cards), lay the three 3s as a
   * set (the 51-point minimum does not apply when going out), discard the drawn card.
   *
   * @param {object} gs - Game state.
   * @param {string} userId - The player on turn.
   */
  goOutFromHand(gs, userId) {
    gs.hands[userId] = [
      { id: 9900, suit: 'clubs', rank: '3', value: 3 },
      { id: 9901, suit: 'diamonds', rank: '3', value: 3 },
      { id: 9902, suit: 'hearts', rank: '3', value: 3 },
    ];
    gs.phase = 'draw';
  },

  /**
   * Szúró hand. Table: [8♥ 9♥ 10♥]. Hand: [J♣ J♦ J♠ Q♣ Q♦ Q♠ J♥]. Draw anything,
   * lay the two sets (60 points), signal handolás, lay off J♥ onto the hearts run,
   * then discard the drawn card.
   *
   * @param {object} gs - Game state.
   * @param {string} userId - The player on turn.
   */
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

  /**
   * Joker swap. Table: [3♣ 3♦ 3♥ Joker], the player has already laid down.
   * Hand: [3♠ 8♣ 9♣ 10♣ 7♠ 5♥], discard phase. Swap 3♠ for the joker, lay
   * [8♣ Joker 10♣] (the joker must be used this turn), then discard.
   *
   * @param {object} gs - Game state.
   * @param {string} userId - The player on turn.
   */
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

  /**
   * Cserelap exchange. Swap card: A♠, discard phase, first draw round (the only
   * time the exchange is allowed). Trade one card for the Ace, then discard.
   *
   * @param {object} gs - Game state.
   * @param {string} userId - The player on turn.
   */
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

  /**
   * Handolás with the cserelap. Swap card: 3♥, hand: [3♣ 3♦ 7♠], draw phase.
   * Draw the cserelap, lay [3♣ 3♦ 3♥], discard 7♠.
   *
   * @param {object} gs - Game state.
   * @param {string} userId - The player on turn.
   */
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
