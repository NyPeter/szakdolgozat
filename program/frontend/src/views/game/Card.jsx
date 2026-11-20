import React from 'react';

// Maps the rank values used in the game state to the filename segment used
// by the SVG-cards-1.3 deck. Number cards already match ('2' → '2'), so only
// face cards and the ace need an explicit mapping.
const RANK_TO_FILENAME = {
  Ace: 'ace', Jack: 'jack', Queen: 'queen', King: 'king',
};

// Builds the public-directory path for a card image.
// Jokers alternate between the red and black variant using the card's unique id
// so the two visually differ within the same hand.
function cardSrc(card) {
  if (card.rank === 'Joker') {
    return card.id % 2 === 0
      ? '/SVG-cards-1.3/red_joker.svg'
      : '/SVG-cards-1.3/black_joker.svg';
  }
  const rank = RANK_TO_FILENAME[card.rank] ?? card.rank;
  return `/SVG-cards-1.3/${rank}_of_${card.suit}.svg`;
}

// A single playing card.
//
// Props:
//   card      – { id, suit, rank, value } from the game state
//   faceDown  – show the card back (used for opponent hands and the draw pile)
//   selected  – blue tint + lift, used for meld selection in Step 3
//   mustUse   – gold border glow, marks the discard-pile card the player
//               must use in a meld before they are allowed to discard
//   isNew     – green outline and "Új" label, marks the card drawn this turn
//   onClick   – enables pointer cursor and hover lift animation
//   style     – forwarded to the outer wrapper (use for width/height overrides)
export function Card({
  card, faceDown = false, selected = false, mustUse = false, isNew = false, onClick, style,
}) {
  const src = faceDown ? '/Card_back.svg' : (card ? cardSrc(card) : null);
  if (!src) return null;

  const altText = faceDown ? 'Kártya háta'
    : card.rank === 'Joker' ? 'Joker'
      : `${card.rank} ${card.suit}`;

  const cls = [
    'card-wrapper',
    onClick ? 'card-clickable' : '',
    selected ? 'card-selected' : '',
    mustUse ? 'card-must-use' : '',
  ].filter(Boolean).join(' ');

  return (
    // The wrapper div owns all sizing, cursor, and filter effects.
    // Default size matches a standard poker card (63×88). Override via style.
    <div className={cls} onClick={onClick} style={{ width: 63, height: 88, ...style }}>
      <img src={src} alt={altText} className="card-img" draggable={false} />
      {/* Tint overlays sit above the image and are invisible to pointer events */}
      {selected && <div className="card-overlay card-overlay-selected" />}
      {mustUse && <div className="card-overlay card-overlay-must-use" />}
      {isNew && <div className="card-overlay card-overlay-new" />}
      {isNew && <span className="card-new-label">Új</span>}
    </div>
  );
}
