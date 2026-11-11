import React, { useState, useEffect } from 'react';
import { Badge, Button, ButtonGroup } from 'react-bootstrap';

const api = import.meta.env.VITE_API_URL || "http://localhost:4000";

// ── Hand sorting ────────────────────────────────────────────────────────────
const RANK_ORDER = ['2','3','4','5','6','7','8','9','10','Jack','Queen','King','Ace','Joker'];
const SUIT_ORDER = ['clubs','diamonds','hearts','spades'];

function sortBySuit(cards) {
  return [...cards].sort((a, b) => {
    const sa = a.suit === null ? SUIT_ORDER.length : SUIT_ORDER.indexOf(a.suit);
    const sb = b.suit === null ? SUIT_ORDER.length : SUIT_ORDER.indexOf(b.suit);
    if (sa !== sb) return sa - sb;
    return RANK_ORDER.indexOf(a.rank) - RANK_ORDER.indexOf(b.rank);
  });
}

function sortByRank(cards) {
  return [...cards].sort((a, b) => {
    const ra = RANK_ORDER.indexOf(a.rank);
    const rb = RANK_ORDER.indexOf(b.rank);
    if (ra !== rb) return ra - rb;
    const sa = a.suit === null ? SUIT_ORDER.length : SUIT_ORDER.indexOf(a.suit);
    const sb = b.suit === null ? SUIT_ORDER.length : SUIT_ORDER.indexOf(b.suit);
    return sa - sb;
  });
}

import { getSocket } from '../../socket';
import { Card } from './Card';
import './GameBoard.css';

const TURN_SECONDS = 60;

// Preload all card images on first mount to avoid slow first-load in a game.
function useCardPreload() {
  useEffect(() => {
    const suits = ['clubs', 'diamonds', 'hearts', 'spades'];
    const ranks = ['ace', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king'];
    const preload = (src) => { const img = new Image(); img.src = src; };
    suits.forEach((s) => ranks.forEach((r) => preload(`/SVG-cards-1.3/${r}_of_${s}.svg`)));
    preload('/SVG-cards-1.3/red_joker.svg');
    preload('/SVG-cards-1.3/black_joker.svg');
    preload('/Card_back.svg');
  }, []);
}

export function GameBoard({ room, gameState: gs, userId }) {
  useCardPreload();

  const [actionError, setActionError] = useState('');
  const [sortMode, setSortMode] = useState('suit');
  const [selectedCards, setSelectedCards] = useState(new Set());
  const [pendingGroups, setPendingGroups] = useState([]);
  const [targetMeldId, setTargetMeldId] = useState(null);
  const [jokerSwapTarget, setJokerSwapTarget] = useState(null);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);

  // Countdown timer — only relevant when it's this player's turn.
  // Re-runs whenever the server issues a new timer timestamp (turn boundary).
  useEffect(() => {
    if (!gs.turnTimerStartedAt) return undefined;
    const update = () => {
      const elapsed = (Date.now() - gs.turnTimerStartedAt) / 1000;
      setTimeLeft(Math.max(0, Math.ceil(TURN_SECONDS - elapsed)));
    };
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, [gs.turnTimerStartedAt]);

  // ── Derived values ─────────────────────────────────────────────────────
  const myId = String(userId);
  const currentPlayerId = String(gs.players[gs.turnIndex]);
  const isMyTurn = currentPlayerId === myId;
  const myHand = gs.hands[myId] ?? [];
  const topDiscard = gs.discardPile.length > 0
    ? gs.discardPile[gs.discardPile.length - 1]
    : null;

  const playerNames = Object.fromEntries(
    room.players.map((p) => [String(p.id), p.name]),
  );

  const playerAvatars = Object.fromEntries(
    room.players.map((p) => [String(p.id), p.avatarURL ?? null]),
  );

  const opponents = gs.players.filter((id) => String(id) !== myId);
  const surrendered = gs.surrenderedPlayers ?? [];

  const stagedCardIds = new Set(pendingGroups.flat());
  const sortedHand = (sortMode === 'suit' ? sortBySuit(myHand) : sortByRank(myHand))
    .filter((c) => !stagedCardIds.has(c.id));

  // ── Socket emit helper ─────────────────────────────────────────────────
  function emit(event, data, onOk) {
    const socket = getSocket();
    if (!socket) return;
    setActionError('');
    socket.emit(event, data, (res) => {
      if (res?.error) {
        setActionError(res.error);
      } else if (onOk) {
        onOk();
      }
    });
  }

  function clearSelections() {
    setSelectedCards(new Set());
    setTargetMeldId(null);
    setJokerSwapTarget(null);
    setPendingGroups([]);
  }

  // ── Action handlers ────────────────────────────────────────────────────

  function handleDrawDeck() {
    if (!isMyTurn || gs.phase !== 'draw') return;
    emit('game:draw', { source: 'deck' });
  }

  function handleDrawDiscard() {
    if (!isMyTurn || gs.phase !== 'draw' || !topDiscard) return;
    emit('game:draw', { source: 'discard' });
  }

  function handleCserelapClick() {
    if (!isMyTurn || gs.phase !== 'draw' || !gs.cserelap || gs.hasFirstMeld?.[myId]) return;
    emit('game:draw', { source: 'cserelap' });
  }

  function handleCardClick(card) {
    if (!isMyTurn) return;
    if (gs.phase !== 'discard') return;
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (next.has(card.id)) {
        next.delete(card.id);
      } else {
        next.add(card.id);
      }
      return next;
    });
  }

  function handleStageGroup() {
    if (!isMyTurn || gs.phase !== 'discard' || selectedCards.size < 3) return;
    setPendingGroups((prev) => [...prev, Array.from(selectedCards)]);
    setSelectedCards(new Set());
  }

  function handleCserelapSwap() {
    if (!isMyTurn || gs.phase !== 'discard' || !gs.cserelap || selectedCards.size !== 1) return;
    const [cardId] = selectedCards;
    emit('game:cserelapSwap', { giveCardId: cardId }, clearSelections);
  }

  function handleMeld() {
    if (!isMyTurn || gs.phase !== 'discard') return;
    const groups = [...pendingGroups];
    if (selectedCards.size >= 3) groups.push(Array.from(selectedCards));
    if (groups.length === 0) return;
    emit('game:meld', { groups }, () => {
      clearSelections();
    });
  }

  function handleDob() {
    if (!isMyTurn || gs.phase !== 'discard' || selectedCards.size !== 1) return;
    const [cardId] = selectedCards;
    emit('game:discard', { cardId }, clearSelections);
  }

  function handleTargetMeld(meldId) {
    if (!isMyTurn || gs.phase !== 'discard') return;
    setJokerSwapTarget(null);
    setTargetMeldId((prev) => (prev === meldId ? null : meldId));
  }

  function handleSzuras() {
    if (!isMyTurn || gs.phase !== 'discard') return;
    if (targetMeldId === null || selectedCards.size !== 1) return;
    const [cardId] = selectedCards;
    emit('game:szuras', { meldId: targetMeldId, cardId }, clearSelections);
  }

  function handleJokerClick(meldId, jokerId) {
    if (!isMyTurn || gs.phase !== 'discard') return;
    if (!gs.hasFirstMeld?.[myId]) return;
    setTargetMeldId(null);
    setJokerSwapTarget((prev) => (
      prev?.meldId === meldId && prev?.jokerId === jokerId
        ? null
        : { meldId, jokerId }
    ));
  }

  function handleJokerSwap() {
    if (!isMyTurn || gs.phase !== 'discard') return;
    if (!jokerSwapTarget || selectedCards.size !== 1) return;
    const [naturalCardId] = selectedCards;
    emit('game:jokerSwap', {
      meldId: jokerSwapTarget.meldId,
      jokerId: jokerSwapTarget.jokerId,
      naturalCardId,
    }, clearSelections);
  }

  function handleUndoDraw() {
    emit('game:undoDraw', {});
  }

  function handleHandolasBid() {
    emit('game:handolasBid', {});
  }

  // ── Status message ─────────────────────────────────────────────────────
  function statusText() {
    if (!isMyTurn) return `${playerNames[currentPlayerId] ?? '?'} lép...`;
    if (gs.phase === 'draw') {
      const cserelapHint = gs.cserelap ? ' vagy vedd fel a cserelapot (handoláshoz)' : '';
      return `Húzz lapot a talonból vagy a dobóhalomból${cserelapHint}`;
    }
    if (jokerSwapTarget) return 'Válassz lapot a kezedből a dzsóker cseréjéhez';
    if (targetMeldId !== null) return 'Válassz egy lapot a kezedből, majd nyomj Szúrást';
    if (gs.swappedJoker) return 'Használd fel a megszerzett dzsókert (tedd le kombinációba)';
    if (gs.discardDrawnCard) return 'Használd fel a dobóhalomból felvett lapot, majd dobj el egyet';
    if (gs.cserelapDrawn) return 'Fejezd be a handolást (rakd le a lapjaid), vagy vonj vissza';
    if (gs.handolasBid?.[myId]) return 'Handolás: szúrj be minden szükséges lapot, majd dobj el az utolsót';
    if (gs.firstMeldTurnPlayer === myId) return 'Leraktad az első kombinációd — jelezd a handolást, vagy dobj el egy lapot';
    return 'Rakj le kombinációkat, cseréld a cserelapot, szúrj, vagy dobj el egy lapot';
  }

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="game-board">

      {/* ── Top bar: round + countdown + scores ───────────────────────── */}
      <div className="gb-top-bar">
        <div className="gb-round">
          <Badge bg="secondary">{gs.round}. kör / 7</Badge>
          {isMyTurn && gs.turnTimerStartedAt && (
            <Badge bg={timeLeft <= 10 ? 'danger' : 'dark'}>
              ⏱ {timeLeft}s
            </Badge>
          )}
        </div>
        {gs.scores && (
          <div className="gb-scores">
            {gs.players.map((id) => {
              const strId = String(id);
              return (
                <span key={strId} className="gb-score-entry">
                  {playerNames[strId] ?? strId}: <strong>{gs.scores[strId] ?? 0}</strong>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Opponents strip ─────────────────────────────────────────────── */}
      <div className="gb-opponents">
        {opponents.map((id) => {
          const strId = String(id);
          const handData = gs.hands[strId];
          const count = typeof handData?.count === 'number'
            ? handData.count
            : (Array.isArray(handData) ? handData.length : 0);
          const isActive = strId === currentPlayerId;
          const hasSurrendered = surrendered.includes(strId);

          return (
            <div
              key={strId}
              className={`gb-opponent ${isActive ? 'gb-opponent-active' : ''} ${hasSurrendered ? 'gb-opponent-surrendered' : ''}`}
            >
              {playerAvatars[strId] && (
                <img
                  src={`${api}${playerAvatars[strId]}`}
                  alt=""
                  className="gb-opponent-avatar"
                />
              )}
              <div className="gb-opponent-name">
                {playerNames[strId] ?? '?'}
                {gs.hasFirstMeld?.[strId] && (
                  <Badge bg="success" style={{ fontSize: '0.6rem' }}>✓</Badge>
                )}
                {hasSurrendered && (
                  <Badge bg="secondary" style={{ fontSize: '0.6rem' }}>Feladta</Badge>
                )}
              </div>

              <div className="gb-opponent-fan">
                {Array.from({ length: Math.min(count, 12) }).map((_, i) => (
                  <Card
                    key={i}
                    faceDown
                    style={{
                      width: 28,
                      height: 40,
                      position: 'absolute',
                      left: i * 10,
                      top: 0,
                      zIndex: i,
                    }}
                  />
                ))}
                {count > 12 && (
                  <span className="gb-fan-overflow" style={{ left: 12 * 10 + 6 }}>
                    +{count - 12}
                  </span>
                )}
              </div>

              <div className="gb-opponent-count">{count} lap</div>
            </div>
          );
        })}
      </div>

      {/* ── Piles (cserelap / talon / discard) ──────────────────────────── */}
      <div className="gb-piles">

        <div className="gb-pile">
          <div className="gb-pile-label">
            Cserelap
            {gs.cserelap && isMyTurn && gs.phase === 'draw' && (
              <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>
                (handoláshoz)
              </span>
            )}
          </div>
          {gs.cserelap ? (
            <Card
              card={gs.cserelap}
              onClick={isMyTurn && gs.phase === 'draw' && !gs.hasFirstMeld?.[myId] ? handleCserelapClick : undefined}
            />
          ) : (
            <div className="gb-pile-empty">–</div>
          )}
        </div>

        <div className="gb-pile">
          <div className="gb-pile-label">Talon ({gs.drawPile.remaining})</div>
          <Card
            faceDown
            onClick={isMyTurn && gs.phase === 'draw' ? handleDrawDeck : undefined}
          />
        </div>

        <div className="gb-pile">
          <div className="gb-pile-label">Dobóhalom ({gs.discardPile.length})</div>
          {topDiscard ? (
            <Card
              card={topDiscard}
              onClick={isMyTurn && gs.phase === 'draw' ? handleDrawDiscard : undefined}
            />
          ) : (
            <div className="gb-pile-empty">Üres</div>
          )}
        </div>
      </div>

      {/* ── Melds zone (horizontally scrollable) ────────────────────────── */}
      <div className="gb-melds">
        {gs.melds.length === 0 && (
          <span className="gb-melds-empty">Lerakott kombinációk</span>
        )}
        {gs.melds.map((meld) => {
          const isTarget = targetMeldId === meld.id;
          return (
            <div
              key={meld.id}
              className={`gb-meld-group ${isTarget ? 'gb-meld-target' : ''}`}
              onClick={() => handleTargetMeld(meld.id)}
              title={`${playerNames[meld.playerId] ?? '?'} — ${meld.type === 'set' ? 'csoport' : 'sor'}`}
            >
              <div className="gb-meld-owner">
                {playerNames[meld.playerId] ?? '?'}
              </div>
              <div className="gb-meld-cards">
                {meld.cards.map((card) => {
                  const isJokerTarget = jokerSwapTarget?.meldId === meld.id
                    && jokerSwapTarget?.jokerId === card.id;
                  return (
                    <Card
                      key={card.id}
                      card={card}
                      selected={isJokerTarget}
                      onClick={
                        card.rank === 'Joker' && isMyTurn
                          && gs.phase === 'discard' && gs.hasFirstMeld?.[myId]
                          ? (e) => { e.stopPropagation(); handleJokerClick(meld.id, card.id); }
                          : undefined
                      }
                      style={{ width: 50, height: 70 }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Action buttons (above hand) ─────────────────────────────────── */}
      {isMyTurn && gs.phase === 'discard' && (
        <div className="gb-actions">

          {pendingGroups.length > 0 && (
            <div className="gb-pending">
              {pendingGroups.map((ids, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <span key={i} className="gb-pending-group">
                  {ids.length} lapos csoport
                </span>
              ))}
            </div>
          )}

          {!gs.hasFirstMeld?.[myId]
            && selectedCards.size >= 3
            && targetMeldId === null
            && jokerSwapTarget === null && (
            <Button variant="outline-success" size="sm" onClick={handleStageGroup}>
              + Csoport rögzítése
            </Button>
          )}

          {(pendingGroups.length > 0 || selectedCards.size >= 3)
            && targetMeldId === null
            && jokerSwapTarget === null
            && (selectedCards.size === 0 || selectedCards.size >= 3) && (
            <Button variant="success" size="sm" onClick={handleMeld}>
              Lerak
              {pendingGroups.length > 0 && selectedCards.size >= 3
                ? ` (${pendingGroups.length + 1} csoport)`
                : pendingGroups.length > 0
                  ? ` (${pendingGroups.length} csoport)`
                  : ` (${selectedCards.size} lap)`}
            </Button>
          )}

          {selectedCards.size === 1
            && pendingGroups.length === 0
            && targetMeldId === null
            && jokerSwapTarget === null && (
            <Button variant="danger" size="sm" onClick={handleDob}>
              Dob
            </Button>
          )}

          {selectedCards.size === 1
            && targetMeldId !== null
            && jokerSwapTarget === null && (
            <Button variant="info" size="sm" onClick={handleSzuras}>
              Szúrás
            </Button>
          )}

          {selectedCards.size === 1 && jokerSwapTarget !== null && (
            <Button variant="warning" size="sm" onClick={handleJokerSwap}>
              Joker csere
            </Button>
          )}

          {selectedCards.size === 1
            && gs.cserelap
            && !gs.hasFirstMeld?.[myId]
            && targetMeldId === null
            && jokerSwapTarget === null
            && pendingGroups.length === 0 && (
            <Button variant="outline-info" size="sm" onClick={handleCserelapSwap}>
              Cserelap csere
            </Button>
          )}

          {gs.firstMeldTurnPlayer === myId && !gs.handolasBid?.[myId] && (
            <Button variant="outline-primary" size="sm" onClick={handleHandolasBid}>
              Handolás befejezés
            </Button>
          )}
          {gs.handolasBid?.[myId] && (
            <Button variant="primary" size="sm" onClick={handleHandolasBid}>
              Kéz visszavonás
            </Button>
          )}

          {(gs.discardDrawnCard || gs.cserelapDrawn) && (
            <Button variant="outline-warning" size="sm" onClick={handleUndoDraw}>
              Visszavonás
            </Button>
          )}

          {(selectedCards.size > 0
            || pendingGroups.length > 0
            || targetMeldId !== null
            || jokerSwapTarget !== null) && (
            <Button variant="outline-secondary" size="sm" onClick={clearSelections}>
              Mégse
            </Button>
          )}
        </div>
      )}

      {/* ── Player's own hand ────────────────────────────────────────────── */}
      <div className="gb-hand-wrap">
        <div className="gb-hand-label">
          Kezed ({myHand.length} lap)
          {gs.hasFirstMeld?.[myId]
            ? <Badge bg="success" className="ms-2">Minimum teljesítve</Badge>
            : <Badge bg="warning" text="dark" className="ms-2">Min. 51 pont</Badge>}
          <ButtonGroup size="sm" className="gb-sort-buttons ms-auto">
            <Button
              variant={sortMode === 'suit' ? 'light' : 'outline-light'}
              onClick={() => setSortMode('suit')}
            >
              Szín
            </Button>
            <Button
              variant={sortMode === 'rank' ? 'light' : 'outline-light'}
              onClick={() => setSortMode('rank')}
            >
              Rang
            </Button>
          </ButtonGroup>
        </div>

        <div className="gb-hand">
          {sortedHand.map((card) => {
            const isMustUse = gs.discardDrawnCard?.id === card.id
              || gs.swappedJoker?.id === card.id;
            return (
              <Card
                key={card.id}
                card={card}
                selected={selectedCards.has(card.id)}
                mustUse={isMustUse}
                onClick={() => handleCardClick(card)}
              />
            );
          })}
        </div>
      </div>

      {/* ── Status bar ──────────────────────────────────────────────────── */}
      <div className="gb-status">
        <span className="gb-status-text">{statusText()}</span>
        {actionError && <span className="gb-error ms-3">{actionError}</span>}
      </div>
    </div>
  );
}
