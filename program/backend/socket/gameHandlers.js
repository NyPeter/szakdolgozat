const db = require('../models');

const { Game, GameUser } = db;

const {
  gameStates, gameRoundData, emitGameState, turnTimers, clearTurnTimer,
  saveTurnSnapshot, restoreTurnSnapshot, clearGameMemory,
} = require('./store');

const {
  initGameState, shuffle,
  isValidMeld, isValidSet, meldValueForMinimum, sortMeldCards, canSwapJokerInMeld,
  calculateRoundScores,
} = require('./gameEngine');

const msg = require('../utils/messages');
const { serverError } = require('../utils/serverError');

const TURN_TIMEOUT_MS = 60_000;

/**
 * Moves the turn to the next player who has not surrendered.
 *
 * @param {object} gs - Game state.
 * @param {Array<string>} [surrendered] - Ids of surrendered players.
 */
function advanceTurn(gs, surrendered) {
  const s = surrendered ?? [];
  let next = (gs.turnIndex + 1) % gs.players.length;
  let safety = 0;
  while (s.includes(String(gs.players[next])) && safety < gs.players.length) {
    next = (next + 1) % gs.players.length;
    safety += 1;
  }
  // The free first draw round normally closes when the player at index 0 draws.
  // If that player has surrendered, close it when the turn order wraps instead.
  if (gs.isFirstTurn && next <= gs.turnIndex && s.includes(String(gs.players[0]))) {
    gs.isFirstTurn = false;
  }
  gs.turnIndex = next;
  gs.phase = 'draw';
}

/**
 * Clears everything that belongs to the turn that just ended and passes the
 * turn to the next active player.
 *
 * @param {object} gs - Game state.
 * @param {string} userId - The player whose turn ended.
 * @param {Array<string>} [surrendered] - Ids of surrendered players.
 */
function endTurn(gs, userId, surrendered) {
  advanceTurn(gs, surrendered);
  gs.discardDrawnCard = null;
  gs.swapCardDrawn = null;
  gs.swappedJoker = null;
  gs.drawSource = null;
  gs.drawnCardId = null;
  gs.firstMeldTurnPlayer = null;
  gs.usedLayOffThisTurn = false;
  gs.goOutFromHandBid[userId] = false;
  gs.layOffHistory = [];
}

/**
 * Draws the top card of the deck into the player's hand. When the deck is empty,
 * the discard pile (minus its top card) is reshuffled and becomes the new deck.
 *
 * @param {object} gs - Game state.
 * @param {string} userId - The drawing player.
 * @returns {object|null} The drawn card, or null when there is nothing left to draw.
 */
function drawFromDeck(gs, userId) {
  if (gs.drawPile.length === 0) {
    if (gs.discardPile.length <= 1) return null;
    const top = gs.discardPile.pop();
    gs.drawPile = shuffle([...gs.discardPile]);
    gs.discardPile = [top];
  }
  const card = gs.drawPile.pop();
  gs.hands[userId].push(card);
  gs.drawSource = 'deck';
  gs.drawnCardId = card.id;
  return card;
}

/**
 * Whether the player has started something this turn that the rules oblige
 * them to finish before discarding: a card taken from the discard pile or a
 * swapped joker still in the hand, a drawn cserelap, or szúrás under a handolás bid.
 *
 * @param {object} gs - Game state.
 * @param {string} userId - The player on turn.
 * @returns {boolean} True when the turn is half-finished.
 */
function hasPendingObligation(gs, userId) {
  const hand = gs.hands[userId];
  const inHand = (card) => !!card && hand.some((c) => c.id === card.id);
  return inHand(gs.discardDrawnCard)
    || inHand(gs.swappedJoker)
    || !!gs.swapCardDrawn
    || (gs.goOutFromHandBid[userId] && gs.layOffHistory.length > 0);
}

/**
 * Starts the 60-second timer of the current turn and saves the turn's starting
 * state (for undo and for rolling back a half-finished turn).
 *
 * @param {object} io - Socket.IO server.
 * @param {number} gameId - Game id.
 */
function startTurnTimer(io, gameId) {
  clearTurnTimer(gameId);
  const gs = gameStates.get(gameId);
  if (gs) {
    gs.turnTimerStartedAt = Date.now();
    saveTurnSnapshot(gameId, gs);
  }
  const t = setTimeout(() => handleTimeout(io, gameId), TURN_TIMEOUT_MS);
  turnTimers.set(gameId, t);
}

/**
 * The turn timer ran out. The third timeout in a row counts as surrender;
 * otherwise the server draws and discards for the player.
 *
 * @param {object} io - Socket.IO server.
 * @param {number} gameId - Game id.
 * @returns {Promise<void>}
 */
async function handleTimeout(io, gameId) {
  const gs = gameStates.get(gameId);
  if (!gs) return;
  const rd = gameRoundData.get(gameId);
  if (!rd) return;

  const userId = String(gs.players[gs.turnIndex]);
  rd.consecutiveTimeouts[userId] = (rd.consecutiveTimeouts[userId] || 0) + 1;

  if (rd.consecutiveTimeouts[userId] >= 3) {
    await handleSurrender(io, gameId, userId);
    return;
  }

  // A half-finished turn (unused discard/swapCard draw, unused swapped joker,
  // unfinished handolás) is rolled back to how the turn started.
  if (hasPendingObligation(gs, userId)) restoreTurnSnapshot(gameId, gs);

  let drawn = null;
  if (gs.phase === 'draw') {
    drawn = drawFromDeck(gs, userId);
    // Same rule as in game:draw: the free first draw round ends with player 0's draw.
    if (gs.turnIndex === 0 && gs.isFirstTurn) gs.isFirstTurn = false;
    gs.phase = 'discard';
  }

  // Discard the card drawn just now, otherwise the last card of the hand.
  const hand = gs.hands[userId];
  const card = drawn ?? hand[hand.length - 1];

  if (card) {
    gs.hands[userId] = hand.filter((c) => c.id !== card.id);
    gs.discardPile.push(card);

    if (gs.hands[userId].length === 0) {
      await handleRoundEnd(io, gameId, gs, userId);
      return;
    }
  }

  endTurn(gs, userId, rd.surrenderedPlayers);
  startTurnTimer(io, gameId);
  await emitGameState(io, gameId, gs);
}

/**
 * Marks a player as surrendered. With one player left, that player wins the game;
 * otherwise the game goes on, and if it was their turn, the turn passes on.
 *
 * @param {object} io - Socket.IO server.
 * @param {number} gameRoomId - Game id.
 * @param {number|string} userId - The surrendering player.
 * @returns {Promise<void>}
 */
async function handleSurrender(io, gameRoomId, userId) {
  const gs = gameStates.get(gameRoomId);
  const rd = gameRoundData.get(gameRoomId);
  if (!gs || !rd) return;

  const strId = String(userId);
  if (!rd.surrenderedPlayers.includes(strId)) {
    rd.surrenderedPlayers.push(strId);
    await GameUser.update(
      { isSurrendered: true },
      { where: { gameID: gameRoomId, userID: Number(strId) } },
    );
  }

  const remaining = gs.players.filter((id) => !rd.surrenderedPlayers.includes(String(id)));

  if (remaining.length <= 1) {
    const winnerId = remaining.length === 1 ? Number(remaining[0]) : null;
    if (winnerId) {
      await Game.update({ status: 'finished', winnerID: winnerId }, { where: { id: gameRoomId } });
    }
    io.to(`game:${gameRoomId}`).emit('game:over', {
      scores: rd.scores,
      roundHistory: rd.roundHistory,
      winnerId: winnerId ? String(winnerId) : null,
      surrenderWin: true,
      surrenderedPlayers: rd.surrenderedPlayers,
    });
    clearGameMemory(gameRoomId);
    return;
  }

  // If it was the surrendered player's turn, take back what they left
  // half-done on the table and pass the turn on.
  if (String(gs.players[gs.turnIndex]) === strId) {
    if (hasPendingObligation(gs, strId)) restoreTurnSnapshot(gameRoomId, gs);
    endTurn(gs, strId, rd.surrenderedPlayers);
    startTurnTimer(io, gameRoomId);
  }

  await emitGameState(io, gameRoomId, gs);
}

/**
 * A player went out: scores the round, then either ends the game (after round 7,
 * lowest total wins) or deals the next round after the 6-second round summary.
 *
 * @param {object} io - Socket.IO server.
 * @param {number} gameRoomId - Game id.
 * @param {object} gs - Game state of the finished round.
 * @param {string} roundWinnerId - The player who went out.
 * @returns {Promise<void>}
 */
async function handleRoundEnd(io, gameRoomId, gs, roundWinnerId) {
  clearTurnTimer(gameRoomId);

  // Player ids are compared as strings everywhere in the game state.
  const winnerId = String(roundWinnerId);
  const isGoOutFromHand = gs.firstMeldTurnPlayer === winnerId;
  const isGoOutFromHandWithLayOff = isGoOutFromHand && gs.usedLayOffThisTurn;
  const roundScores = calculateRoundScores(
    gs,
    winnerId,
    isGoOutFromHand,
    isGoOutFromHandWithLayOff,
  );

  const rd = gameRoundData.get(gameRoomId);
  rd.roundHistory.push({
    round: rd.round, scores: roundScores, winnerId, isGoOutFromHand, isGoOutFromHandWithLayOff,
  });
  for (const [pid, pts] of Object.entries(roundScores)) {
    rd.scores[pid] = (rd.scores[pid] || 0) + pts;
  }

  if (rd.round >= 7) {
    // Someone who surrendered during this last round is still in gs.players,
    // but cannot win the game.
    const sortedPlayers = gs.players
      .filter((id) => !rd.surrenderedPlayers.includes(String(id)))
      .map((id) => [String(id), rd.scores[String(id)]])
      .sort((a, b) => a[1] - b[1]);
    const gameWinnerId = Number(sortedPlayers[0][0]);

    await Game.update(
      { status: 'finished', winnerID: gameWinnerId },
      { where: { id: gameRoomId } },
    );

    io.to(`game:${gameRoomId}`).emit('game:over', {
      scores: rd.scores,
      roundHistory: rd.roundHistory,
      winnerId: String(gameWinnerId),
      lastRound: { scores: roundScores, winnerId, isGoOutFromHand, isGoOutFromHandWithLayOff },
      surrenderedPlayers: rd.surrenderedPlayers,
    });
    clearGameMemory(gameRoomId);
  } else {
    io.to(`game:${gameRoomId}`).emit('game:roundOver', {
      round: rd.round,
      scores: roundScores,
      totalScores: { ...rd.scores },
      winnerId,
      isGoOutFromHand,
      isGoOutFromHandWithLayOff,
    });

    rd.round += 1;
    const activePlayers = rd.playerIds.filter(
      (id) => !(rd.surrenderedPlayers ?? []).includes(String(id)),
    );
    const nextGs = initGameState(activePlayers, rd.round);
    gameStates.set(gameRoomId, nextGs);

    setTimeout(async () => {
      // The game may have ended (surrender) while the round summary was shown.
      if (gameStates.get(gameRoomId) !== nextGs) return;
      startTurnTimer(io, gameRoomId);
      await emitGameState(io, gameRoomId, nextGs);
    }, 6000);
  }
}

/**
 * Registers the in-game events: draw, cserelap exchange, discard, meld, szúrás,
 * handolás bid, joker swap, undo, surrender, and the dev presets.
 *
 * @param {object} io - Socket.IO server.
 * @param {object} socket - The connected socket.
 */
function registerInGameHandlers(io, socket) {
  socket.on('game:draw', async ({ source }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });

      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });

      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'draw') return callback({ error: msg.ALREADY_DRAWN });

      const userId = String(socket.user.id);

      if (source === 'deck') {
        if (!drawFromDeck(gs, userId)) return callback({ error: msg.DECK_EMPTY });
      } else if (source === 'discard') {
        if (gs.discardPile.length === 0) return callback({ error: msg.DISCARD_PILE_EMPTY });
        const card = gs.discardPile.pop();
        gs.hands[userId].push(card);
        // Only impose the use-obligation outside the free first-turn window.
        if (!gs.isFirstTurn) gs.discardDrawnCard = card;
        gs.drawSource = 'discard';
        gs.drawnCardId = card.id;
      } else if (source === 'swapCard') {
        if (!gs.swapCard) return callback({ error: msg.NO_SWAP_CARD });
        if (gs.hasFirstMeld[userId]) {
          return callback({ error: msg.SWAP_CARD_AFTER_FIRST_MELD });
        }
        const card = gs.swapCard;
        gs.hands[userId].push(card);
        gs.swapCard = null;
        gs.swapCardDrawn = card;
        gs.drawSource = 'swapCard';
        gs.drawnCardId = card.id;
      } else {
        return callback({ error: msg.INVALID_DRAW_SOURCE });
      }

      // Close the first-turn window once the turn order wraps back to index 0.
      if (gs.turnIndex === 0 && gs.isFirstTurn) gs.isFirstTurn = false;

      gs.phase = 'discard';
      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // Only in the first draw round after dealing ("Először az osztást követő
  // húzáskörben cserélheti..."), the player may trade one hand card for the swapCard.
  // The given card becomes the new face-up swapCard; the old swapCard enters the
  // player's hand. This does NOT end the turn — the player must still discard.
  socket.on('game:exchangeSwapCard', async ({ giveCardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'discard') return callback({ error: msg.MUST_DRAW_FIRST });
      if (!gs.swapCard) return callback({ error: msg.NO_SWAP_CARD });
      if (!gs.isFirstTurn) return callback({ error: msg.SWAP_CARD_EXCHANGE_FIRST_ROUND_ONLY });

      const userId = String(socket.user.id);
      if (gs.hasFirstMeld[userId]) {
        return callback({ error: msg.SWAP_CARD_AFTER_FIRST_MELD });
      }
      const hand = gs.hands[userId];

      const giveIndex = hand.findIndex((c) => c.id === giveCardId);
      if (giveIndex === -1) return callback({ error: msg.CARD_NOT_IN_HAND });

      const [given] = hand.splice(giveIndex, 1);
      hand.push(gs.swapCard);
      gs.swapCard = given;

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  socket.on('game:discard', async ({ cardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });

      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });

      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'discard') return callback({ error: msg.MUST_DRAW_FIRST });

      const userId = String(socket.user.id);
      const hand = gs.hands[userId];

      const cardIndex = hand.findIndex((c) => c.id === cardId);
      if (cardIndex === -1) return callback({ error: msg.CARD_NOT_IN_HAND });

      if (gs.discardDrawnCard?.id === cardId) {
        return callback({ error: msg.DISCARD_TAKEN_CARD });
      }

      if (gs.discardDrawnCard && hand.some((c) => c.id === gs.discardDrawnCard.id)) {
        return callback({ error: msg.USE_TAKEN_CARD_FIRST });
      }

      if (gs.swappedJoker && hand.some((c) => c.id === gs.swappedJoker.id)) {
        return callback({ error: msg.USE_JOKER_FIRST });
      }

      // A drawn cserelap may only be used for handolás: this discard must empty the hand.
      if (gs.swapCardDrawn && hand.length > 1) {
        return callback({ error: msg.FINISH_SWAP_CARD_GO_OUT });
      }

      // Szúrás made under a handolás bid only stands if the player goes out.
      if (gs.goOutFromHandBid[userId] && gs.layOffHistory.length > 0 && hand.length > 1) {
        return callback({ error: msg.FINISH_GO_OUT_FROM_HAND_BID });
      }

      const [card] = hand.splice(cardIndex, 1);
      gs.discardPile.push(card);

      if (gs.hands[userId].length === 0) {
        await handleRoundEnd(io, gameRoomId, gs, userId);
        return callback({ ok: true });
      }

      // Only timeouts in a row count towards the automatic surrender.
      const rd = gameRoundData.get(gameRoomId);
      if (rd?.consecutiveTimeouts) rd.consecutiveTimeouts[userId] = 0;

      endTurn(gs, userId, rd?.surrenderedPlayers);

      startTurnTimer(io, gameRoomId);
      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // Lays one or more groups at once (all or none). Payload: { groups: [[cardId, ...], ...] }
  socket.on('game:meld', async ({ groups }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'discard') return callback({ error: msg.MUST_DRAW_FIRST });

      const userId = String(socket.user.id);
      const hand = gs.hands[userId];

      if (!Array.isArray(groups) || groups.length === 0) {
        return callback({ error: msg.NO_CARDS_SELECTED });
      }

      // Validate every group before touching any state.
      const resolvedGroups = [];
      const usedIds = new Set();

      for (const cardIds of groups) {
        if (!Array.isArray(cardIds) || cardIds.length < 3) {
          return callback({ error: msg.MELD_TOO_SHORT });
        }

        const groupCards = [];
        for (const cardId of cardIds) {
          if (usedIds.has(cardId)) {
            return callback({ error: msg.CARD_IN_TWO_GROUPS });
          }
          const found = hand.find((c) => c.id === cardId);
          if (!found) return callback({ error: msg.CARD_NOT_IN_HAND });
          groupCards.push(found);
          usedIds.add(cardId);
        }

        if (!isValidMeld(groupCards)) {
          return callback({ error: msg.INVALID_MELD });
        }

        resolvedGroups.push(groupCards);
      }

      // The round can only be finished with a discard, so one card must stay in hand.
      if (usedIds.size >= hand.length) {
        return callback({ error: msg.KEEP_ONE_CARD });
      }

      // First-meld minimum: waived when the player is using all-or-all-but-one cards
      // (handolás bid — "kézből történő befejezésnél nem kötelező a lerakási minimum").
      if (!gs.hasFirstMeld[userId]) {
        const isGoOutFromHandBid = usedIds.size >= hand.length - 1;
        if (!isGoOutFromHandBid) {
          const total = resolvedGroups.reduce((sum, g) => sum + meldValueForMinimum(g), 0);
          if (total < 51) {
            return callback({ error: msg.FIRST_MELD_MINIMUM(total) });
          }
        }
      }

      gs.hands[userId] = hand.filter((c) => !usedIds.has(c.id));

      for (const groupCards of resolvedGroups) {
        const type = isValidSet(groupCards) ? 'set' : 'run';
        gs.melds.push({
          id: gs.meldCounter,
          playerId: userId,
          type,
          cards: sortMeldCards(groupCards, type),
        });
        gs.meldCounter += 1;
      }

      if (!gs.hasFirstMeld[userId]) {
        gs.hasFirstMeld[userId] = true;
        gs.firstMeldTurnPlayer = userId;
      }

      // A card the player had to use is fulfilled once it left the hand.
      if (gs.discardDrawnCard && !gs.hands[userId].some((c) => c.id === gs.discardDrawnCard.id)) {
        gs.discardDrawnCard = null;
      }
      if (gs.swappedJoker && !gs.hands[userId].some((c) => c.id === gs.swappedJoker.id)) {
        gs.swappedJoker = null;
      }

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // Szúrás: one card from the hand onto a table meld. Payload: { meldId, cardId }
  socket.on('game:layOff', async ({ meldId, cardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'discard') return callback({ error: msg.MUST_DRAW_FIRST });

      const userId = String(socket.user.id);

      if (!gs.hasFirstMeld[userId]) {
        return callback({ error: msg.LAY_OFF_BEFORE_FIRST_MELD });
      }

      // Szúrás on the first-meld turn is only allowed when the player has declared
      // a handolás finish intention via game:goOutFromHandBid.
      const hand = gs.hands[userId];
      if (gs.firstMeldTurnPlayer === userId && !gs.goOutFromHandBid[userId]) {
        return callback({ error: msg.LAY_OFF_ONLY_WITH_GO_OUT_FROM_HAND });
      }

      const meld = gs.melds.find((m) => m.id === meldId);
      if (!meld) return callback({ error: msg.MELD_NOT_FOUND });

      const cardIndex = hand.findIndex((c) => c.id === cardId);
      if (cardIndex === -1) return callback({ error: msg.CARD_NOT_IN_HAND });
      if (hand.length <= 1) {
        return callback({ error: msg.KEEP_ONE_CARD });
      }
      const card = hand[cardIndex];

      if (!isValidMeld([...meld.cards, card])) {
        return callback({ error: msg.CARD_DOES_NOT_FIT });
      }

      hand.splice(cardIndex, 1);
      meld.cards.push(card);
      meld.cards = sortMeldCards(meld.cards, meld.type);
      gs.usedLayOffThisTurn = true;

      if (gs.goOutFromHandBid[userId]) {
        gs.layOffHistory.push({ meldId: meld.id, card });
      }

      if (gs.discardDrawnCard && !hand.some((c) => c.id === gs.discardDrawnCard.id)) {
        gs.discardDrawnCard = null;
      }
      if (gs.swappedJoker && !hand.some((c) => c.id === gs.swappedJoker.id)) {
        gs.swappedJoker = null;
      }

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // Toggles the player's handolás finish intention on the first-meld turn.
  // Turning ON:  allows szúrás this turn; operations are logged to layOffHistory.
  // Turning OFF: reverts all szúrás from layOffHistory in reverse order,
  //              restoring the hand and the affected table melds to their
  //              pre-bid state. The player can then just discard normally.
  socket.on('game:goOutFromHandBid', async (_, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'discard') return callback({ error: msg.MUST_DRAW_FIRST });

      const userId = String(socket.user.id);

      if (gs.firstMeldTurnPlayer !== userId) {
        return callback({ error: msg.GO_OUT_FROM_HAND_ONLY_FIRST_MELD_TURN });
      }

      if (gs.goOutFromHandBid[userId]) {
        const hand = gs.hands[userId];
        for (let i = gs.layOffHistory.length - 1; i >= 0; i -= 1) {
          const { meldId, card } = gs.layOffHistory[i];
          const meld = gs.melds.find((m) => m.id === meldId);
          if (meld) {
            meld.cards = meld.cards.filter((c) => c.id !== card.id);
            meld.cards = sortMeldCards(meld.cards, meld.type);
          }
          hand.push(card);
        }
        gs.layOffHistory = [];
        gs.goOutFromHandBid[userId] = false;
        gs.usedLayOffThisTurn = false;
      } else {
        gs.goOutFromHandBid[userId] = true;
      }

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // Replace a joker in a table meld with a natural card from hand.
  // The joker enters hand and MUST be immediately reused (tracked via swappedJoker).
  // Payload: { meldId, jokerId, naturalCardId }
  socket.on('game:jokerSwap', async ({ meldId, jokerId, naturalCardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'discard') return callback({ error: msg.MUST_DRAW_FIRST });

      const userId = String(socket.user.id);
      if (!gs.hasFirstMeld[userId]) {
        return callback({ error: msg.JOKER_SWAP_BEFORE_FIRST_MELD });
      }
      if (gs.swappedJoker) {
        return callback({ error: msg.USE_JOKER_FIRST });
      }

      const meld = gs.melds.find((m) => m.id === meldId);
      if (!meld) return callback({ error: msg.MELD_NOT_FOUND });

      const hand = gs.hands[userId];
      const naturalIdx = hand.findIndex((c) => c.id === naturalCardId);
      if (naturalIdx === -1) return callback({ error: msg.CARD_NOT_IN_HAND });
      const naturalCard = hand[naturalIdx];

      if (!canSwapJokerInMeld(meld, naturalCard, jokerId)) {
        return callback({ error: msg.CANNOT_REPLACE_JOKER });
      }

      const jokerInMeld = meld.cards.find((c) => c.id === jokerId);

      hand.splice(naturalIdx, 1);
      meld.cards = meld.cards.map((c) => (c.id === jokerId ? naturalCard : c));
      hand.push(jokerInMeld);

      gs.swappedJoker = jokerInMeld;

      if (gs.discardDrawnCard && !hand.some((c) => c.id === gs.discardDrawnCard.id)) {
        gs.discardDrawnCard = null;
      }

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // Undo a draw from the discard pile or from the swapCard (handolás draw).
  // Returns the card and reverts to draw phase — no replacement card is issued.
  socket.on('game:undoDraw', async (_, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }

      // Only a face-up draw can be taken back; a card from the deck is hidden
      // information the player has already seen.
      if (gs.phase !== 'discard' || !['discard', 'swapCard'].includes(gs.drawSource)) {
        return callback({ error: msg.NOTHING_TO_UNDO });
      }

      // Everything done since the draw (melds, szúrás, joker swap) is taken back
      // with it, so the table returns to its state at the start of the turn.
      if (!restoreTurnSnapshot(gameRoomId, gs)) {
        return callback({ error: msg.NOTHING_TO_UNDO });
      }

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  socket.on('game:surrender', async (_, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      await handleSurrender(io, gameRoomId, socket.user.id);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line global-require -- loaded only outside production
    const DEV_PRESETS = require('./devPresets');
    socket.on('game:devPreset', ({ preset }, callback) => {
      const gs = gameStates.get(socket.gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      const userId = String(socket.user.id);
      if (String(gs.players[gs.turnIndex]) !== userId) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      const fn = DEV_PRESETS[preset];
      if (!fn) {
        return callback({ error: msg.UNKNOWN_PRESET(preset, Object.keys(DEV_PRESETS).join(', ')) });
      }
      fn(gs, userId);
      saveTurnSnapshot(socket.gameRoomId, gs);
      emitGameState(io, socket.gameRoomId, gs);
      return callback({ ok: true, preset });
    });
  }
}

module.exports = { registerInGameHandlers, handleRoundEnd, startTurnTimer };
