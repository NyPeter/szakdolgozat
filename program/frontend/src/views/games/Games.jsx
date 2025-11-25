import React, { useEffect, useState } from "react";
import axios from "axios";
import { Button, Container, Table, Spinner } from "react-bootstrap";
import "./Games.css";

export const Games = () => {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = async (p) => {
    setLoading(true);

    try {
      const token = localStorage.getItem("accessToken");

      const { data } = await axios.get(
        `http://localhost:4000/games/${p}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setRows(data.rows);
      setCount(data.count);
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
    // TODO: implement backend join route when ready
    console.log("Join game:", gameId);
  };

  const createLobby = () => {
    // TODO: backend creation route not implemented yet
    console.log("Create new lobby");
  };

  return (
    <Container fluid className="games-container">
      <div className="games-header">
        <Button variant="secondary" href="/" className="games-back-btn">
          Vissza a Menübe
        </Button>

        <h1 className="games-title">Csatlakozható Szobák</h1>

        <Button variant="success" onClick={createLobby} className="games-create-btn">
          Új Szoba Létrehozása
        </Button>
      </div>

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
                const full = game.playerCount >= 6;

                return (
                  <tr key={game.id}>
                    <td>{game.id}</td>
                    <td>{game.owner}</td>
                    <td>{game.playerCount}/6</td>
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
        </>
      )}
    </Container>
  );
};
