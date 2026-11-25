import { useEffect, useState } from 'react';
import { Badge, Button } from 'react-bootstrap';

const AUTO_DISMISS_SECONDS = 6;

/**
 * The round summary, closed automatically after 6 seconds (when the server
 * deals the next round).
 *
 * @param {object} props - Component props.
 * @param {object} props.data - The `game:roundOver` event.
 * @param {object} props.playerNames - Names by player id.
 * @param {Function} props.onDismiss - Closes the summary.
 * @returns {object} The overlay.
 */
export function RoundOver({ data, playerNames, onDismiss }) {
  const [seconds, setSeconds] = useState(AUTO_DISMISS_SECONDS);

  useEffect(() => {
    const id = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) { clearInterval(id); onDismiss(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // Started once: the parent passes a new onDismiss on every render, which
    // would restart the countdown each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = Object.entries(data.totalScores).sort((a, b) => a[1] - b[1]);

  return (
    <div className="go-backdrop">
      <div className="go-box">
        <h3 className="go-title">
          {data.round}. kör vége
          {data.isGoOutFromHand && !data.isGoOutFromHandWithLayOff && (
            <Badge bg="warning" text="dark" className="ms-2">Handolás!</Badge>
          )}
          {data.isGoOutFromHandWithLayOff && (
            <Badge bg="info" className="ms-2">Szúró hand!</Badge>
          )}
        </h3>
        <p className="go-winner">
          Nyertes: <strong>{playerNames[data.winnerId] ?? 'Törölt játékos'}</strong>
        </p>
        <table className="go-table">
          <thead>
            <tr>
              <th>Játékos</th>
              <th>Ez a kör</th>
              <th>Összesen</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(([pid, total]) => (
              <tr key={pid} className={pid === data.winnerId ? 'go-row-winner' : ''}>
                <td>{playerNames[pid] ?? 'Törölt játékos'}</td>
                <td className={data.scores[pid] < 0 ? 'go-pts-negative' : 'go-pts-positive'}>
                  {data.scores[pid] > 0 ? `+${data.scores[pid]}` : data.scores[pid]}
                </td>
                <td>{total > 0 ? `+${total}` : total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="go-countdown">
          Következő kör {seconds} másodperc múlva...
        </p>
        <Button variant="outline-light" size="sm" onClick={onDismiss}>
          Folytatás
        </Button>
      </div>
    </div>
  );
}
