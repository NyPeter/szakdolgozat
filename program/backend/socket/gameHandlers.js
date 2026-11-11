/* eslint-disable object-curly-newline */
/* eslint-disable jsdoc/require-jsdoc */
/* eslint-disable no-param-reassign */
/* eslint-disable no-use-before-define */
const db = require('../models');

const { Game, GameUser } = db;

const { gameStates, gameRoundData, emitGameState, turnTimers, clearTurnTimer } = require('./store');

const {
  initGameState, shuffle,
  isValidMeld, isValidSet, meldValueForMinimum, sortMeldCards, canSwapJokerInMeld,
  calculateRoundScores,
} = require('./gameEngine');

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
  gs.turnIndex = next;
  gs.phase = 'draw';
}

// ── Turn timer ────────────────────────────────────────────────────────────────
function startTurnTimer(io, gameId) {
  clearTurnTimer(gameId);
  const gs = gameStates.get(gameId);
  if (gs) gs.turnTimerStartedAt = Date.now();
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

  // Auto-draw if still in draw phase
  if (gs.phase === 'draw') {
    if (gs.drawPile.length === 0 && gs.discardPile.length > 1) {
      const top = gs.discardPile.pop();
      gs.drawPile = shuffle([...gs.discardPile]);
      gs.discardPile = [top];
    }
    if (gs.drawPile.length > 0) {
      gs.hands[userId].push(gs.drawPile.pop());
    }
    gs.phase = 'discard';
  }

  // Auto-discard first non-must-use card
  const hand = gs.hands[userId];
  const card = hand.find(
    (c) => c.id !== gs.discardDrawnCard?.id && c.id !== gs.swappedJoker?.id,
  ) || hand[0];

  if (!card) {
    advanceTurn(gs, rd.surrenderedPlayers);
    startTurnTimer(io, gameId);
    await emitGameState(io, gameId, gs);
    return;
  }

  gs.hands[userId] = hand.filter((c) => c.id !== card.id);
  gs.discardPile.push(card);
  gs.discardDrawnCard = null;
  gs.cserelapDrawn = null;
  gs.swappedJoker = null;
  gs.handolasBid[userId] = false;
  gs.szurasHistory = [];
  gs.firstMeldTurnPlayer = null;
  gs.usedSzurasThisTurn = false;

  if (gs.hands[userId].length === 0) {
    await handleRoundEnd(io, gameId, gs, Number(userId));
    return;
  }

  advanceTurn(gs, rd.surrenderedPlayers);
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
    clearTurnTimer(gameRoomId);
    gameStates.delete(gameRoomId);
    gameRoundData.delete(gameRoomId);
    return;
  }

  // If it was the surrendered player's turn, advance to next
  if (String(gs.players[gs.turnIndex]) === strId) {
    gs.discardDrawnCard = null;
    gs.cserelapDrawn = null;
    gs.swappedJoker = null;
    gs.firstMeldTurnPlayer = null;
    gs.usedSzurasThisTurn = false;
    gs.handolasBid[strId] = false;
    gs.szurasHistory = [];
    advanceTurn(gs, rd.surrenderedPlayers);
    startTurnTimer(io, gameRoomId);
  }

  await emitGameState(io, gameRoomId, gs);
}

// ── Round / game end ──────────────────────────────────────────────────────────
async function handleRoundEnd(io, gameRoomId, gs, winnerId) {
  clearTurnTimer(gameRoomId);

  const isHandolas = gs.firstMeldTurnPlayer === String(winnerId);
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
    const sortedPlayers = [...gs.players]
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
    gameStates.delete(gameRoomId);
    gameRoundData.delete(gameRoomId);
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
      if (!gameRoomId) return callback({ error: 'Not in a room.' });

      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });

      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }
      if (gs.phase !== 'draw') return callback({ error: 'Not draw phase.' });

      const userId = String(socket.user.id);

      if (source === 'deck') {
        // When the draw pile is empty, the discard pile (minus its top card) is
        // reshuffled and becomes the new draw pile. The top discard card stays.
        if (gs.drawPile.length === 0) {
          if (gs.discardPile.length <= 1) return callback({ error: 'No cards left to draw.' });
          const top = gs.discardPile.pop();
          gs.drawPile = shuffle([...gs.discardPile]);
          gs.discardPile = [top];
        }
        gs.hands[userId].push(gs.drawPile.pop());
      } else if (source === 'discard') {
        if (gs.discardPile.length === 0) return callback({ error: 'Discard pile is empty.' });
        const card = gs.discardPile.pop();
        gs.hands[userId].push(card);
        // Only impose the use-obligation outside the free first-turn window.
        if (!gs.isFirstTurn) gs.discardDrawnCard = card;
      } else if (source === 'cserelap') {
        if (!gs.cserelap) return callback({ error: 'Nincs cserelap az asztalon.' });
        if (gs.hasFirstMeld[userId]) {
          return callback({ error: 'Az első lerakás után nem húzhatod a cserelapot.' });
        }
        const card = gs.cserelap;
        gs.hands[userId].push(card);
        gs.cserelap = null;
        gs.cserelapDrawn = card;
      } else {
        return callback({ error: 'Invalid source.' });
      }

      // Close the first-turn window once the turn order wraps back to index 0.
      if (gs.turnIndex === 0 && gs.isFirstTurn) gs.isFirstTurn = false;

      gs.phase = 'discard';
      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback({ error: err.message });
    }
  });

  // ── game:cserelapSwap ──────────────────────────────────────────────────────
  // During the discard phase the player may trade one hand card for the cserelap.
  // The given card becomes the new face-up cserelap; the old cserelap enters the
  // player's hand. This does NOT end the turn — the player must still discard.
  socket.on('game:cserelapSwap', async ({ giveCardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }
      if (gs.phase !== 'discard') return callback({ error: 'Nem dobási fázisban vagy.' });
      if (!gs.cserelap) return callback({ error: 'Nincs cserelap az asztalon.' });

      const userId = String(socket.user.id);
      if (gs.hasFirstMeld[userId]) {
        return callback({ error: 'Az első lerakás után nem cserélheted a cserelapot.' });
      }
      const hand = gs.hands[userId];

      const giveIndex = hand.findIndex((c) => c.id === giveCardId);
      if (giveIndex === -1) return callback({ error: 'Card not in hand.' });

      const [given] = hand.splice(giveIndex, 1);
      hand.push(gs.cserelap);
      gs.cserelap = given;

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback({ error: err.message });
    }
  });

  socket.on('game:discard', async ({ cardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });

      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });

      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }
      if (gs.phase !== 'discard') return callback({ error: 'Not discard phase.' });

      const userId = String(socket.user.id);
      const hand = gs.hands[userId];

      const cardIndex = hand.findIndex((c) => c.id === cardId);
      if (cardIndex === -1) return callback({ error: 'Card not in hand.' });

      // The card taken from the discard pile cannot be immediately discarded back.
      if (gs.discardDrawnCard?.id === cardId) {
        return callback({ error: 'A dobóhalomból felvett lapot nem dobhatod vissza azonnal.' });
      }

      // If the discard-drawn card is still in hand, it must be melded first.
      if (gs.discardDrawnCard && hand.some((c) => c.id === gs.discardDrawnCard.id)) {
        return callback({ error: 'Előbb használd fel a dobóhalomból felvett lapot.' });
      }

      // A joker acquired by replacing it in a table meld must be immediately reused.
      if (gs.swappedJoker && hand.some((c) => c.id === gs.swappedJoker.id)) {
        return callback({ error: 'A kicserélt dzsókert azonnal fel kell használnod.' });
      }

      // Cserelap was drawn: must complete handolás (empty hand), not just discard.
      if (gs.cserelapDrawn && hand.length > 1) {
        return callback({ error: 'Cserelapot húztál — fejezd be a handolást, vagy vonj vissza.' });
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
      advanceTurn(gs, rd?.surrenderedPlayers);
      gs.discardDrawnCard = null;
      gs.cserelapDrawn = null;
      gs.swappedJoker = null;
      gs.firstMeldTurnPlayer = null;
      gs.usedSzurasThisTurn = false;
      gs.handolasBid[userId] = false;
      gs.szurasHistory = [];

      startTurnTimer(io, gameRoomId);
      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback({ error: err.message });
    }
  });

  // ── game:meld ──────────────────────────────────────────────────────────────
  // Lay one or more meld groups from hand onto the table in one atomic action.
  // Payload: { groups: [[cardId, ...], ...] }
  socket.on('game:meld', async ({ groups }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }
      if (gs.phase !== 'discard') return callback({ error: 'Not discard phase.' });

      const userId = String(socket.user.id);
      const hand = gs.hands[userId];

      if (!Array.isArray(groups) || groups.length === 0) {
        return callback({ error: 'No groups provided.' });
      }

      // Validate every group before touching any state.
      const resolvedGroups = [];
      const usedIds = new Set();

      // eslint-disable-next-line no-restricted-syntax
      for (const cardIds of groups) {
        if (!Array.isArray(cardIds) || cardIds.length < 3) {
          return callback({ error: 'Each meld needs at least 3 cards.' });
        }

        const groupCards = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const cardId of cardIds) {
          if (usedIds.has(cardId)) {
            return callback({ error: 'Same card used in multiple groups.' });
          }
          const found = hand.find((c) => c.id === cardId);
          if (!found) return callback({ error: 'Card not in hand.' });
          groupCards.push(found);
          usedIds.add(cardId);
        }

        if (!isValidMeld(groupCards)) {
          return callback({ error: 'Invalid meld.' });
        }

        resolvedGroups.push(groupCards);
      }

      // First-meld minimum: waived when the player is using all-or-all-but-one cards
      // (handolás bid — "kézből történő befejezésnél nem kötelező a lerakási minimum").
      if (!gs.hasFirstMeld[userId]) {
        const isHandolasBid = usedIds.size >= hand.length - 1;
        if (!isHandolasBid) {
          const total = resolvedGroups.reduce((sum, g) => sum + meldValueForMinimum(g), 0);
          if (total < 51) {
            return callback({ error: `First meld must total at least 51 points (yours: ${total}).` });
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
      return callback({ error: err.message });
    }
  });

  // ── game:szuras ────────────────────────────────────────────────────────────
  // Add a single card from hand to an existing table meld.
  // Payload: { meldId, cardId }
  socket.on('game:szuras', async ({ meldId, cardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }
      if (gs.phase !== 'discard') return callback({ error: 'Not discard phase.' });

      const userId = String(socket.user.id);

      if (!gs.hasFirstMeld[userId]) {
        return callback({ error: 'You must meet the first-meld minimum before adding to existing melds.' });
      }

      // Szúrás on the first-meld turn is only allowed when the player has declared
      // a handolás finish intention via game:handolasBid.
      const hand = gs.hands[userId];
      if (gs.firstMeldTurnPlayer === userId && !gs.handolasBid[userId]) {
        return callback({ error: 'Az első lerakás körében csak kéz-befejezéskor szúrhatsz — jelezd a szándékod!' });
      }

      const meld = gs.melds.find((m) => m.id === meldId);
      if (!meld) return callback({ error: 'Meld not found.' });

      const cardIndex = hand.findIndex((c) => c.id === cardId);
      if (cardIndex === -1) return callback({ error: 'Card not in hand.' });
      const card = hand[cardIndex];

      if (!isValidMeld([...meld.cards, card])) {
        return callback({ error: 'Card does not fit this meld.' });
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
      return callback({ error: err.message });
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
      if (!gameRoomId) return callback({ error: 'Not in a room.' });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }
      if (gs.phase !== 'discard') return callback({ error: 'Not discard phase.' });

      const userId = String(socket.user.id);

      if (gs.firstMeldTurnPlayer !== userId) {
        return callback({ error: 'Handolás csak az első lerakás körében jelölhető.' });
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
      return callback({ error: err.message });
    }
  });

  // ── game:jokerSwap ─────────────────────────────────────────────────────────
  // Replace a joker in a table meld with a natural card from hand.
  // The joker enters hand and MUST be immediately reused (tracked via swappedJoker).
  // Payload: { meldId, jokerId, naturalCardId }
  socket.on('game:jokerSwap', async ({ meldId, jokerId, naturalCardId }, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }
      if (gs.phase !== 'discard') return callback({ error: 'Not discard phase.' });

      const userId = String(socket.user.id);
      if (!gs.hasFirstMeld[userId]) {
        return callback({ error: 'You must meet the first-meld minimum before swapping jokers.' });
      }
      if (gs.swappedJoker) {
        return callback({ error: 'You must reuse the joker you already took before swapping another.' });
      }

      const meld = gs.melds.find((m) => m.id === meldId);
      if (!meld) return callback({ error: 'Meld not found.' });

      const hand = gs.hands[userId];
      const naturalIdx = hand.findIndex((c) => c.id === naturalCardId);
      if (naturalIdx === -1) return callback({ error: 'Natural card not in hand.' });
      const naturalCard = hand[naturalIdx];

      if (!canSwapJokerInMeld(meld, naturalCard, jokerId)) {
        return callback({ error: 'This card cannot replace the joker in that meld.' });
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
      return callback({ error: err.message });
    }
  });

  // ── game:undoDraw ──────────────────────────────────────────────────────────
  // Undo a draw from the discard pile or from the cserelap (handolás draw).
  // Returns the card and reverts to draw phase — no replacement card is issued.
  socket.on('game:undoDraw', async (_, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });
      if (String(gs.players[gs.turnIndex]) !== String(socket.user.id)) {
        return callback({ error: 'Not your turn.' });
      }

      const userId = String(socket.user.id);
      const hand = gs.hands[userId];

      if (gs.discardDrawnCard) {
        const idx = hand.findIndex((c) => c.id === gs.discardDrawnCard.id);
        if (idx !== -1) {
          const [returned] = hand.splice(idx, 1);
          gs.discardPile.push(returned);
        }
        gs.discardDrawnCard = null;
      } else if (gs.cserelapDrawn) {
        const idx = hand.findIndex((c) => c.id === gs.cserelapDrawn.id);
        if (idx !== -1) hand.splice(idx, 1);
        gs.cserelap = gs.cserelapDrawn;
        gs.cserelapDrawn = null;
      } else {
        return callback({ error: 'Nothing to undo.' });
      }

      gs.phase = 'draw';

      await emitGameState(io, gameRoomId, gs);
      return callback({ ok: true });
    } catch (err) {
      return callback({ error: err.message });
    }
  });

  // ── game:surrender ────────────────────────────────────────────────────────
  socket.on('game:surrender', async (_, callback) => {
    try {
      const { gameRoomId } = socket;
      if (!gameRoomId) return callback({ error: 'Not in a room.' });
      const gs = gameStates.get(gameRoomId);
      if (!gs) return callback({ error: 'Game not started.' });
      await handleSurrender(io, gameRoomId, socket.user.id);
      return callback({ ok: true });
    } catch (err) {
      return callback({ error: err.message });
    }
  });

  // ── dev presets (non-production only) ────────────────────────────────────────
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line global-require
    const DEV_PRESETS = require('./devPresets');
    socket.on('game:devPreset', ({ preset }, callback) => {
      const gs = gameStates.get(socket.gameRoomId);
      if (!gs) return callback({ error: 'No active game.' });
      const userId = String(socket.user.id);
      if (String(gs.players[gs.turnIndex]) !== userId) return callback({ error: 'Not your turn.' });
      const fn = DEV_PRESETS[preset];
      if (!fn) return callback({ error: `Unknown preset: "${preset}". Available: ${Object.keys(DEV_PRESETS).join(', ')}` });
      fn(gs, userId);
      emitGameState(io, socket.gameRoomId, gs);
      return callback({ ok: true, preset });
    });
  }
}

module.exports = { registerInGameHandlers, handleRoundEnd, startTurnTimer };
