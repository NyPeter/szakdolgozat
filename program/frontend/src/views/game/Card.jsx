// Maps the rank values used in the game state to the filename segment used
// by the SVG-cards-1.3 deck. Number cards already match ('2' → '2'), so only
// face cards and the ace need an explicit mapping.
const RANK_TO_FILENAME = {
  Ace: 'ace', Jack: 'jack', Queen: 'queen', King: 'king',
};

/**
 * Path of a card image in public/. Jokers are red or black by their id, so two
 * jokers in the same hand look different.
 *
 * @param {object} card - `{ id, suit, rank }`.
 * @returns {string} The image URL.
 */
function cardSrc(card) {
  if (card.rank === 'Joker') {
    return card.id % 2 === 0
      ? '/SVG-cards-1.3/red_joker.svg'
      : '/SVG-cards-1.3/black_joker.svg';
  }
  const rank = RANK_TO_FILENAME[card.rank] ?? card.rank;
  return `/SVG-cards-1.3/${rank}_of_${card.suit}.svg`;
}

/**
 * @param {object} card - The card.
 * @param {boolean} faceDown - Whether the back is shown.
 * @returns {string} The image's alt text.
 */
function cardAlt(card, faceDown) {
  if (faceDown) return 'Kártya háta';
  if (card.rank === 'Joker') return 'Joker';
  return `${card.rank} ${card.suit}`;
}

/**
 * A single playing card.
 *
 * @param {object} props - Component props.
 * @param {object} props.card - `{ id, suit, rank, value }` from the game state.
 * @param {boolean} [props.faceDown] - Show the back (opponents' hands, the deck).
 * @param {boolean} [props.selected] - Blue tint and lift: selected for a meld.
 * @param {boolean} [props.mustUse] - Gold glow: the card taken from the discard
 *   pile, which must be used before discarding.
 * @param {boolean} [props.isNew] - Green outline and "Új": drawn this turn.
 * @param {Function} [props.onClick] - Makes the card clickable.
 * @param {object} [props.style] - Extra style for the wrapper (width/height).
 * @returns {object|null} The card.
 */
export function Card({
  card, faceDown = false, selected = false, mustUse = false, isNew = false, onClick, style,
}) {
  if (!faceDown && !card) return null;
  const src = faceDown ? '/Card_back.svg' : cardSrc(card);
  const altText = cardAlt(card, faceDown);

  const cls = [
    'card-wrapper',
    onClick ? 'card-clickable' : '',
    selected ? 'card-selected' : '',
    mustUse ? 'card-must-use' : '',
  ].filter(Boolean).join(' ');

  return (
    // Default size: a standard poker card (63×88).
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
