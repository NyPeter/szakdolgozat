import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router";
import { Alert, Button, Container, Table, Spinner } from "react-bootstrap";
import { getSocket } from "../../socket";
import "./Games.css";

export const Games = () => {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [myActiveGame, setMyActiveGame] = useState(null);
  const navigate = useNavigate();
  const api = import.meta.env.VITE_API_URL || "http://localhost:4000";

  const loadData = async (p) => {
    setLoading(true);
    try {
      const token = localStorage.getItem("accessToken");
      const { data } = await axios.get(`${api}/games/${p}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setRows(data.rows);
      setCount(data.count);
      setMyActiveGame(data.myActiveGame ?? null);
    } catch (err) {
      console.error("Games list error:", err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData(page);
  }, [page]);

  const nextPage = () => {
    if (page * 10 < count) setPage(page + 1);
  };

  const prevPage = () => {
    if (page > 1) setPage(page - 1);
  };

  const joinGame = (gameId) => {
    navigate(`/Game/${gameId}`);
  };

  const createGame = () => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit("game:create", {}, (res) => {
      if (res.error) {
        console.error("Create game error:", res.error);
        return;
      }
      navigate(`/Game/${res.gameId}`);
    });
  };

  return (
    <Container fluid className="games-container">
      <div className="games-header">
        <Button variant="secondary" href="/" className="games-back-btn">
          Vissza a Menübe
        </Button>

        <h1 className="games-title">Csatlakozható Szobák</h1>

        <Button variant="success" onClick={createGame} className="games-create-btn">
          Új Szoba Létrehozása
        </Button>
      </div>

      {myActiveGame && (
        <Alert variant="warning" className="d-flex align-items-center justify-content-between">
          <span>Van egy folyamatban lévő játékod (tulajdonos: <strong>{myActiveGame.owner}</strong>)!</span>
          <Button size="sm" variant="warning" onClick={() => navigate(`/Game/${myActiveGame.id}`)}>
            Visszatérés
          </Button>
        </Alert>
      )}

      {loading ? (
        <Spinner animation="border" variant="light" />
      ) : (
        <>
          <Table bordered hover variant="dark" className="games-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Tulajdonos</th>
                <th>Játékosok</th>
                <th>Csatlakozás</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((game) => {
                const full = game.playerCount >= game.maxPlayers;
                return (
                  <tr key={game.id}>
                    <td>{game.id}</td>
                    <td>
                      {game.owner}
                      {game.hasPassword && " 🔒"}
                    </td>
                    <td>{game.playerCount}/{game.maxPlayers}</td>
                    <td>
                      <Button
                        variant={full ? "secondary" : "success"}
                        disabled={full}
                        onClick={() => joinGame(game.id)}
                      >
                        {full ? "Tele" : "Csatlakozás"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          <div className="games-pagination">
            <Button
              variant="success"
              onClick={prevPage}
              disabled={page === 1}
              className="games-btn"
            >
              Előző
            </Button>

            <span className="games-page">Oldal: {page}</span>

            <Button
              variant="success"
              onClick={nextPage}
              disabled={page * 10 >= count}
              className="games-btn"
            >
              Következő
            </Button>
          </div>

          <Button
            variant="success"
            className="mt-3"
            onClick={() => loadData(page)}
          >
            Frissítés
          </Button>
        </>
      )}
    </Container>
  );
};
