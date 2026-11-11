import React from 'react';
import { Badge, Button } from 'react-bootstrap';

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
            <strong>{playerNames[data.winnerId] ?? data.winnerId}</strong>
          </p>
        ) : (
          <p className="go-winner">
            Győztes:{' '}
            <strong>{playerNames[data.winnerId] ?? data.winnerId}</strong>
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
              <tr key={pid} className={i === 0 ? 'go-row-winner' : ''}>
                <td>{i + 1}.</td>
                <td>
                  {playerNames[pid] ?? pid}
                  {i === 0 && (
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

        {data.lastRound?.isHandolas && !data.lastRound?.isSzuroHand && (
          <p className="go-badge-note">
            <Badge bg="warning" text="dark">Handolás</Badge> az utolsó körben!
          </p>
        )}
        {data.lastRound?.isSzuroHand && (
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
