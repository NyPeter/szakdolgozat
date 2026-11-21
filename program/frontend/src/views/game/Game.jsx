import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import axios from 'axios';
import {
  Button, Container, ListGroup, Modal, Spinner, Form, InputGroup,
} from 'react-bootstrap';
import { getSocket } from '../../socket';
import { GameBoard } from './GameBoard';
import { RoundOver } from './RoundOver';
import { GameOver } from './GameOver';
import './Game.css';

const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const Game = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const gameId = Number(id);
  // The logged-in user's id, from GET /user like the other pages.
  const [userId, setUserId] = useState(null);

  const joinedGameIdRef = useRef(null);
  const messagesEndRef = useRef(null);
  const mountedRef = useRef(false);
  const isWaitingRef = useRef(false);

  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);

  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState('');
  const [gameState, setGameState] = useState(null);

  const [settingsMaxPlayers, setSettingsMaxPlayers] = useState(6);
  const [settingsPassword, setSettingsPassword] = useState('');
  const [settingsError, setSettingsError] = useState('');

  const [roundOverData, setRoundOverData] = useState(null);
  const [gameOverData, setGameOverData] = useState(null);

  const [showSurrender, setShowSurrender] = useState(false);

  const isOwner = room?.owner?.id === userId;
  const isWaiting = room?.status === 'waiting';

  const playerNames = Object.fromEntries(
    (room?.players ?? []).map((p) => [String(p.id), p.name]),
  );

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    axios.get(`${api}/user`, { headers: { Authorization: `Bearer ${token}` } })
      .then(({ data }) => setUserId(data.user.id))
      .catch(() => navigate('/Login'));
  }, [navigate]);

  // Warn before tab close during active game
  useEffect(() => {
    if (!isWaiting && gameState && !gameOverData) {
      const handler = (e) => {
        e.preventDefault();
        e.returnValue = '';
      };
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
    return undefined;
  }, [isWaiting, gameState, gameOverData]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) {
      navigate('/Games');
      return undefined;
    }

    socket.on('game:joined', (state) => {
      setRoom(state);
      setNeedsPassword(false);
      setPasswordError('');
      setSettingsMaxPlayers(state.maxPlayers);
      setMessages(state.messages || []);
    });

    socket.on('game:update', (state) => {
      setRoom(state);
      // Keep the slider at the saved value, also for a player who becomes the owner.
      setSettingsMaxPlayers(state.maxPlayers);
    });

    socket.on('game:started', () => {
      setRoom((prev) => (prev ? { ...prev, status: 'started' } : prev));
    });

    socket.on('chat:message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('game:state', (state) => {
      setGameState(state);
      setRoundOverData(null);
    });

    socket.on('game:roundOver', (data) => {
      setRoundOverData(data);
    });

    socket.on('game:over', (data) => {
      setGameOverData(data);
      setRoundOverData(null);
    });

    socket.on('game:kicked', () => {
      navigate('/Games');
    });

    // Removed from this room because another tab joined or created a room
    socket.on('game:left', () => {
      navigate('/Games');
    });

    const join = () => {
      socket.emit('game:join', { gameId, password: null }, (res) => {
        if (res.needsPassword) {
          setNeedsPassword(true);
        } else if (res.error) {
          setError(res.error);
        }
      });
    };

    if (joinedGameIdRef.current !== gameId) {
      joinedGameIdRef.current = gameId;
      join();
    }

    // After a dropped connection the server sees a new socket that is in no room,
    // so the room has to be joined again.
    socket.io.on('reconnect', join);

    return () => {
      socket.io.off('reconnect', join);
      socket.off('game:joined');
      socket.off('game:update');
      socket.off('game:started');
      socket.off('chat:message');
      socket.off('game:state');
      socket.off('game:roundOver');
      socket.off('game:over');
      socket.off('game:kicked');
      socket.off('game:left');
    };
  }, [gameId, navigate]);

  // Leaving this page while in the waiting room counts as "Kilépés"
  // (a started game is kept, the player can come back to it).
  isWaitingRef.current = isWaiting;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // In development StrictMode unmounts and remounts right away: wait a tick
      // and only leave if the page really stayed unmounted.
      setTimeout(() => {
        if (!mountedRef.current && isWaitingRef.current) {
          getSocket()?.emit('game:leave', {}, () => {});
        }
      }, 0);
    };
  }, []);

  const submitPassword = () => {
    const socket = getSocket();
    if (!socket) return;
    setPasswordError('');
    socket.emit('game:join', { gameId, password: passwordInput }, (res) => {
      if (res.error) {
        setPasswordError(res.error);
      }
    });
  };

  const handleLeave = () => {
    const socket = getSocket();
    if (socket) socket.emit('game:leave', {}, () => {});
    navigate('/Games');
  };

  const handleSurrenderConfirm = () => {
    const socket = getSocket();
    if (!socket) return;
    setShowSurrender(false);
    socket.emit('game:surrender', {}, (res) => {
      if (res.error) {
        setError(res.error);
      } else {
        navigate('/Games');
      }
    });
  };

  const handleKick = (targetUserId) => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('game:kick', { targetUserId }, (res) => {
      if (res.error) setError(res.error);
    });
  };

  const handleStart = () => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('game:start', {}, (res) => {
      if (res.error) setError(res.error);
    });
  };

  const handleSaveSettings = () => {
    const socket = getSocket();
    if (!socket) return;
    setSettingsError('');
    socket.emit('game:settings', { maxPlayers: settingsMaxPlayers, password: settingsPassword || null }, (res) => {
      if (res.error) setSettingsError(res.error);
      else setSettingsPassword('');
    });
  };

  const sendMessage = () => {
    const socket = getSocket();
    if (!socket || !chatInput.trim()) return;
    socket.emit('chat:send', { message: chatInput }, (res) => {
      if (res?.error) setChatError(res.error);
      else setChatError('');
    });
    setChatInput('');
  };

  if (error) {
    return (
      <Container className="game-room-container">
        <p className="game-room-error">{error}</p>
        <Button variant="secondary" onClick={() => navigate('/Games')}>Vissza</Button>
      </Container>
    );
  }

  if (needsPassword) {
    return (
      <Container className="game-room-container">
        <h2 className="game-room-title">Jelszó szükséges</h2>
        <InputGroup className="game-room-password-input">
          <Form.Control
            type="password"
            placeholder="Jelszó"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitPassword()}
            isInvalid={!!passwordError}
          />
          <Button variant="success" onClick={submitPassword}>Csatlakozás</Button>
          <Form.Control.Feedback type="invalid">{passwordError || 'Hibás jelszó.'}</Form.Control.Feedback>
        </InputGroup>
        <Button variant="secondary" className="mt-2" onClick={() => navigate('/Games')}>Vissza</Button>
      </Container>
    );
  }

  if (!room || userId === null) {
    return (
      <Container className="game-room-container">
        <Spinner animation="border" variant="light" />
      </Container>
    );
  }

  const chatPanel = (
    <div className={`game-room-chat-col${!isWaiting ? ' game-room-chat-sidebar' : ''}`}>
      <div className="chat-panel">
        <div className="chat-messages">
          {messages.map((m) => (
            <div key={m.id} className="chat-msg">
              {m.user?.avatarURL && (
                <img
                  src={`${api}${m.user.avatarURL}`}
                  alt=""
                  className="chat-msg-avatar"
                />
              )}
              <span className="chat-msg-name">{m.user?.name}:</span>
              {m.message}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        {chatError && <p className="game-room-error" style={{ fontSize: '0.82rem', margin: '0 0 4px' }}>{chatError}</p>}
        <div className="chat-input-row">
          <Form.Control
            type="text"
            placeholder="Üzenet..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <Button variant="outline-light" onClick={sendMessage}>Küld</Button>
        </div>
      </div>
    </div>
  );

  const handleGameOverClose = () => {
    setGameOverData(null);
    navigate('/Games');
  };

  return (
    <Container fluid className="game-room-container">
      {/* ── Surrender confirmation modal ──────────────────────────────── */}
      <Modal show={showSurrender} onHide={() => setShowSurrender(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Feladás</Modal.Title>
        </Modal.Header>
        <Modal.Body>Biztosan feladod a játékot? Ez visszafordíthatatlan.</Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSurrender(false)}>Mégse</Button>
          <Button variant="danger" onClick={handleSurrenderConfirm}>Feladás</Button>
        </Modal.Footer>
      </Modal>

      {roundOverData && (
        <RoundOver
          data={roundOverData}
          playerNames={playerNames}
          onDismiss={() => setRoundOverData(null)}
        />
      )}
      {gameOverData && (
        <GameOver
          data={gameOverData}
          playerNames={playerNames}
          onClose={handleGameOverClose}
        />
      )}

      <div className="game-room-header">
        {/* Waiting room: leave. Running game: surrender. Finished: an empty
            placeholder keeps the title centred. */}
        {isWaiting && (
          <Button variant="secondary" onClick={handleLeave} className="game-room-btn">
            Kilépés
          </Button>
        )}
        {!isWaiting && !gameOverData && (
          <Button variant="danger" onClick={() => setShowSurrender(true)} className="game-room-btn">
            Feladás
          </Button>
        )}
        {!isWaiting && gameOverData && <div className="game-room-btn" />}

        <h1 className="game-room-title">
          {isWaiting ? 'Váróterem' : 'Játék'}
        </h1>

        <div className="game-room-btn" />
      </div>

      {/* Meta line — only shown in waiting room */}
      {isWaiting && (
        <p className="game-room-meta">
          Tulajdonos: <strong>{room.owner?.name}</strong>
          &nbsp;·&nbsp;
          Játékosok: {room.players.length}/{room.maxPlayers}
          {room.hasPassword && <>&nbsp;·&nbsp;🔒</>}
        </p>
      )}

      {isWaiting ? (
        <div className="game-room-body">
          {/* Left: player list with kick buttons for owner */}
          <div className="game-room-left">
            <ListGroup className="game-room-player-list">
              {room.players.map((p) => (
                <ListGroup.Item
                  key={p.id}
                  variant="dark"
                  className="d-flex justify-content-between align-items-center"
                >
                  <span>
                    {p.name}
                    {p.id === room.owner?.id ? ' (tulajdonos)' : ''}
                  </span>
                  {isOwner && p.id !== userId && (
                    <Button
                      variant="outline-danger"
                      size="sm"
                      className="kick-btn"
                      onClick={() => handleKick(p.id)}
                    >
                      ×
                    </Button>
                  )}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>

          {chatPanel}

          <div className="game-room-right">
            {isOwner && (
              <div className="game-room-settings">
                <h5 className="game-room-settings-title">Szoba beállításai</h5>
                <Form.Group className="mb-2">
                  <Form.Label>Max. játékosok ({settingsMaxPlayers})</Form.Label>
                  <Form.Range
                    min={2}
                    max={6}
                    value={settingsMaxPlayers}
                    onChange={(e) => setSettingsMaxPlayers(Number(e.target.value))}
                  />
                </Form.Group>
                <Form.Group className="mb-2">
                  <Form.Label>Jelszó (üresen hagyva: nincs)</Form.Label>
                  <Form.Control
                    type="password"
                    placeholder="Jelszó beállítása..."
                    value={settingsPassword}
                    onChange={(e) => setSettingsPassword(e.target.value)}
                  />
                </Form.Group>
                {settingsError && <p className="game-room-error">{settingsError}</p>}
                <div className="d-flex gap-2 mt-2">
                  <Button variant="outline-light" size="sm" onClick={handleSaveSettings}>
                    Mentés
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={handleStart}
                    disabled={room.players.length < 2}
                  >
                    Játék Indítása
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="game-room-body">
          <div style={{ flex: 1, minWidth: 0 }}>
            {gameState
              ? <GameBoard room={room} gameState={gameState} userId={userId} />
              : <p className="game-room-placeholder">Várakozás a játék állapotára...</p>}
          </div>

          {chatPanel}
        </div>
      )}
    </Container>
  );
};
