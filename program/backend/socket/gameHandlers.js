/* eslint-disable object-curly-newline */
/* eslint-disable jsdoc/require-jsdoc */
/* eslint-disable no-param-reassign */
/* eslint-disable no-use-before-define */
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

// ── Turn advance helper ───────────────────────────────────────────────────────
// Skips surrendered players when advancing the turn index.
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

// Clears everything that belongs to the turn that just ended and passes the
// turn to the next active player.
function endTurn(gs, userId, surrendered) {
  advanceTurn(gs, surrendered);
  gs.discardDrawnCard = null;
  gs.cserelapDrawn = null;
  gs.swappedJoker = null;
  gs.drawSource = null;
  gs.firstMeldTurnPlayer = null;
  gs.usedSzurasThisTurn = false;
  gs.handolasBid[userId] = false;
  gs.szurasHistory = [];
}

// Draws the top card of the deck into the player's hand. When the deck is empty,
// the discard pile (minus its top card) is reshuffled and becomes the new deck.
// Returns the drawn card, or null when there is nothing left to draw.
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
  return card;
}

// True when the player has started something this turn that the rules oblige
// them to finish before discarding.
function hasPendingObligation(gs, userId) {
  const hand = gs.hands[userId];
  const inHand = (card) => !!card && hand.some((c) => c.id === card.id);
  return inHand(gs.discardDrawnCard)
    || inHand(gs.swappedJoker)
    || !!gs.cserelapDrawn
    || (gs.handolasBid[userId] && gs.szurasHistory.length > 0);
}

// ── Turn timer ────────────────────────────────────────────────────────────────
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

  // A half-finished turn (unused discard/cserelap draw, unused swapped joker,
  // unfinished handolás) is rolled back to how the turn started.
  if (hasPendingObligation(gs, userId)) restoreTurnSnapshot(gameId, gs);

  // Auto-draw if still in draw phase
  let drawn = null;
  if (gs.phase === 'draw') {
    drawn = drawFromDeck(gs, userId);
    // Same rule as in game:draw: the free first draw round ends with player 0's draw.
    if (gs.turnIndex === 0 && gs.isFirstTurn) gs.isFirstTurn = false;
    gs.phase = 'discard';
  }

  // Auto-discard: the card drawn just now, otherwise the last card of the hand
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

// ── Surrender ─────────────────────────────────────────────────────────────────
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

// ── Round / game end ──────────────────────────────────────────────────────────
async function handleRoundEnd(io, gameRoomId, gs, roundWinnerId) {
  clearTurnTimer(gameRoomId);

  // Player ids are compared as strings everywhere in the game state.
  const winnerId = String(roundWinnerId);
  const isHandolas = gs.firstMeldTurnPlayer === winnerId;
  const isSzuroHand = isHandolas && gs.usedSzurasThisTurn;
  const roundScores = calculateRoundScores(gs, winnerId, isHandolas, isSzuroHand);

  const rd = gameRoundData.get(gameRoomId);
  rd.roundHistory.push({
    round: rd.round, scores: roundScores, winnerId, isHandolas, isSzuroHand,
  });
  // eslint-disable-next-line no-restricted-syntax
  for (const [pid, pts] of Object.entries(roundScores)) {
    rd.scores[pid] = (rd.scores[pid] || 0) + pts;
  }

  if (rd.round >= 7) {
    // ── Game over ──────────────────────────────────────────────────────────
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
      lastRound: { scores: roundScores, winnerId, isHandolas, isSzuroHand },
      surrenderedPlayers: rd.surrenderedPlayers,
    });
    clearGameMemory(gameRoomId);
  } else {
    // ── Next round ─────────────────────────────────────────────────────────
    io.to(`game:${gameRoomId}`).emit('game:roundOver', {
      round: rd.round,
      scores: roundScores,
      totalScores: { ...rd.scores },
      winnerId,
      isHandolas,
      isSzuroHand,
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

// ── In-game socket handlers ───────────────────────────────────────────────────
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
      } else if (source === 'cserelap') {
        if (!gs.cserelap) return callback({ error: msg.NO_CSERELAP });
        if (gs.hasFirstMeld[userId]) {
          return callback({ error: msg.CSERELAP_AFTER_FIRST_MELD });
        }
        const card = gs.cserelap;
        gs.hands[userId].push(card);
        gs.cserelap = null;
        gs.cserelapDrawn = card;
        gs.drawSource = 'cserelap';
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

  // ── game:cserelapSwap ──────────────────────────────────────────────────────
  // During the discard phase the player may trade one hand card for the cserelap.
  // The given card becomes the new face-up cserelap; the old cserelap enters the
  // player's hand. This does NOT end the turn — the player must still discard.
  socket.on('game:cserelapSwap', async ({ giveCardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: msg.NOT_IN_ROOM });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: msg.GAME_NOT_STARTED });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: msg.NOT_YOUR_TURN });
      }
      if (gs.phase !== 'discard') return callback({ error: msg.MUST_DRAW_FIRST });
      if (!gs.cserelap) return callback({ error: msg.NO_CSERELAP });

      const userId = String(socket.user.id);
      if (gs.hasFirstMeld[userId]) {
        return callback({ error: msg.CSERELAP_AFTER_FIRST_MELD });
      }
      const hand = gs.hands[userId];

      const giveIndex = hand.findIndex((c) => c.id === giveCardId);
      if (giveIndex === -1) return callback({ error: msg.CARD_NOT_IN_HAND });

      const [given] = hand.splice(giveIndex, 1);
      hand.push(gs.cserelap);
      gs.cserelap = given;

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

      // The card taken from the discard pile cannot be immediately discarded back.
      if (gs.discardDrawnCard?.id === cardId) {
        return callback({ error: msg.DISCARD_TAKEN_CARD });
      }

      // If the discard-drawn card is still in hand, it must be melded first.
      if (gs.discardDrawnCard && hand.some((c) => c.id === gs.discardDrawnCard.id)) {
        return callback({ error: msg.USE_TAKEN_CARD_FIRST });
      }

      // A joker acquired by replacing it in a table meld must be immediately reused.
      if (gs.swappedJoker && hand.some((c) => c.id === gs.swappedJoker.id)) {
        return callback({ error: msg.USE_JOKER_FIRST });
      }

      // Cserelap was drawn: must complete handolás (empty hand), not just discard.
      if (gs.cserelapDrawn && hand.length > 1) {
        return callback({ error: msg.FINISH_CSERELAP_HANDOLAS });
      }

      // Szúrás made under a handolás bid only stands if the player goes out.
      if (gs.handolasBid[userId] && gs.szurasHistory.length > 0 && hand.length > 1) {
        return callback({ error: msg.FINISH_HANDOLAS_BID });
      }

      const [card] = hand.splice(cardIndex, 1);
      gs.discardPile.push(card);

      // Win condition: empty hand ends the round.
      if (gs.hands[userId].length === 0) {
        await handleRoundEnd(io, gameRoomId, gs, userId);
        return callback({ ok: true });
      }

      // Reset consecutive timeout count on successful manual turn completion.
      const rd = gameRoundData.get(gameRoomId);
      if (rd?.consecutiveTimeouts) rd.consecutiveTimeouts[userId] = 0;

      // Advance to the next player (skip surrendered).
      endTurn(gs, userId, rd?.surrenderedPlayers);

      startTurnTimer(io, gameRoomId);
      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // ── game:meld ──────────────────────────────────────────────────────────────
  // Lay one or more meld groups from hand onto the table in one atomic action.
  // Payload: { groups: [[cardId, ...], ...] }
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

      // eslint-disable-next-line no-restricted-syntax
      for (const cardIds of groups) {
        if (!Array.isArray(cardIds) || cardIds.length < 3) {
          return callback({ error: msg.MELD_TOO_SHORT });
        }

        const groupCards = [];
        // eslint-disable-next-line no-restricted-syntax
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
        const isHandolasBid = usedIds.size >= hand.length - 1;
        if (!isHandolasBid) {
          const total = resolvedGroups.reduce((sum, g) => sum + meldValueForMinimum(g), 0);
          if (total < 51) {
            return callback({ error: msg.FIRST_MELD_MINIMUM(total) });
          }
        }
      }

      // Apply: remove used cards from hand, add each group to the table.
      gs.hands[userId] = hand.filter((c) => !usedIds.has(c.id));

      // eslint-disable-next-line no-restricted-syntax
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

      // Clear obligations for cards no longer in hand.
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

  // ── game:szuras ────────────────────────────────────────────────────────────
  // Add a single card from hand to an existing table meld.
  // Payload: { meldId, cardId }
  socket.on('game:szuras', async ({ meldId, cardId }, callback) => {
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
        return callback({ error: msg.SZURAS_BEFORE_FIRST_MELD });
      }

      // Szúrás on the first-meld turn is only allowed when the player has declared
      // a handolás finish intention via game:handolasBid.
      const hand = gs.hands[userId];
      if (gs.firstMeldTurnPlayer === userId && !gs.handolasBid[userId]) {
        return callback({ error: msg.SZURAS_ONLY_WITH_HANDOLAS });
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
      gs.usedSzurasThisTurn = true;

      if (gs.handolasBid[userId]) {
        gs.szurasHistory.push({ meldId: meld.id, card });
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

  // ── game:handolasBid ──────────────────────────────────────────────────────
  // Toggles the player's handolás finish intention on the first-meld turn.
  // Turning ON:  allows szúrás this turn; operations are logged to szurasHistory.
  // Turning OFF: reverts all szúrás from szurasHistory in reverse order,
  //              restoring the hand and the affected table melds to their
  //              pre-bid state. The player can then just discard normally.
  socket.on('game:handolasBid', async (_, callback) => {
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
        return callback({ error: msg.HANDOLAS_ONLY_FIRST_MELD_TURN });
      }

      if (gs.handolasBid[userId]) {
        // ── Cancel bid: revert all szúrás in reverse order ──────────────────
        const hand = gs.hands[userId];
        for (let i = gs.szurasHistory.length - 1; i >= 0; i -= 1) {
          const { meldId, card } = gs.szurasHistory[i];
          const meld = gs.melds.find((m) => m.id === meldId);
          if (meld) {
            meld.cards = meld.cards.filter((c) => c.id !== card.id);
            meld.cards = sortMeldCards(meld.cards, meld.type);
          }
          hand.push(card);
        }
        gs.szurasHistory = [];
        gs.handolasBid[userId] = false;
        gs.usedSzurasThisTurn = false;
      } else {
        // ── Activate bid ─────────────────────────────────────────────────────
        gs.handolasBid[userId] = true;
      }

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback(serverError(err));
    }
  });

  // ── game:jokerSwap ─────────────────────────────────────────────────────────
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

  // ── game:undoDraw ──────────────────────────────────────────────────────────
  // Undo a draw from the discard pile or from the cserelap (handolás draw).
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
      if (gs.phase !== 'discard' || !['discard', 'cserelap'].includes(gs.drawSource)) {
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

  // ── game:surrender ────────────────────────────────────────────────────────
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

  // ── dev presets (non-production only) ────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line global-require
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
