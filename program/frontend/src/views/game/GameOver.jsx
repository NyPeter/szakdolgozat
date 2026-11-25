import { Badge, Button } from 'react-bootstrap';

/**
 * The final results, lowest score first.
 *
 * @param {object} props - Component props.
 * @param {object} props.data - The `game:over` event.
 * @param {object} props.playerNames - Names by player id.
 * @param {Function} props.onClose - Back to the main menu.
 * @returns {object} The overlay.
 */
export function GameOver({ data, playerNames, onClose }) {
  const sorted = Object.entries(data.scores).sort((a, b) => a[1] - b[1]);
  const surrendered = data.surrenderedPlayers ?? [];

  return (
    <div className="go-backdrop">
      <div className="go-box">
        <h2 className="go-title">Játék vége!</h2>
        {data.surrenderWin ? (
          <p className="go-winner">
            Győztes (feladás által):{' '}
            <strong>{playerNames[data.winnerId] ?? 'Törölt játékos'}</strong>
          </p>
        ) : (
          <p className="go-winner">
            Győztes:{' '}
            <strong>{playerNames[data.winnerId] ?? 'Törölt játékos'}</strong>
          </p>
        )}
        <table className="go-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Játékos</th>
              <th>Végeredmény</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(([pid, total], i) => (
              <tr key={pid} className={pid === String(data.winnerId) ? 'go-row-winner' : ''}>
                <td>{i + 1}.</td>
                <td>
                  {playerNames[pid] ?? 'Törölt játékos'}
                  {pid === String(data.winnerId) && (
                    <Badge bg="warning" text="dark" className="ms-1">Győztes</Badge>
                  )}
                  {surrendered.includes(pid) && (
                    <Badge bg="secondary" className="ms-1">Feladta</Badge>
                  )}
                </td>
                <td className={total < 0 ? 'go-pts-negative' : 'go-pts-positive'}>
                  {total > 0 ? `+${total}` : total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {data.lastRound?.isGoOutFromHand && !data.lastRound?.isGoOutFromHandWithLayOff && (
          <p className="go-badge-note">
            <Badge bg="warning" text="dark">Handolás</Badge> az utolsó körben!
          </p>
        )}
        {data.lastRound?.isGoOutFromHandWithLayOff && (
          <p className="go-badge-note">
            <Badge bg="info">Szúró hand</Badge> az utolsó körben!
          </p>
        )}

        <Button variant="primary" className="mt-3" onClick={onClose}>
          Vissza a főmenübe
        </Button>
      </div>
    </div>
  );
}
