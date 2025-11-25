import React, { useEffect, useState } from "react";
import { Button, Container, Table, Spinner } from "react-bootstrap";
import "./LeaderBoard.css";
import axios from "axios";

export const LeaderBoard = () => {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = async (p) => {
    setLoading(true);

    try {
      const token = localStorage.getItem("accessToken");

      const { data } = await axios.get(
        `http://localhost:4000/leaderboard/${p}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      setRows(data.rows);
      setCount(data.count);
    } catch (err) {
      console.error("Leaderboard error:", err);
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

  return (
    <Container fluid className="leaderboard-container">
      <Button variant="secondary" href="/" className="leaderboard-back-btn">
        Vissza a Menübe
      </Button>
      <h1 className="leaderboard-title">Ranglista</h1>

      {loading ? (
        <Spinner animation="border" variant="light" />
      ) : (
        <>
          <Table bordered hover variant="dark" className="leaderboard-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Név</th>
                <th>Megnyert Játékok</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((user, index) => (
                <tr key={user.id}>
                  <td>{(page - 1) * 10 + index + 1}</td>
                  <td>{user.name}</td>
                  <td>{user.gamesWon}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="leaderboard-pagination">
            <Button
              variant="success"
              onClick={prevPage}
              disabled={page === 1}
              className="leaderboard-btn"
            >
              Előző
            </Button>

            <span className="leaderboard-page">Oldal: {page}</span>

            <Button
              variant="success"
              onClick={nextPage}
              disabled={page * 10 >= count}
              className="leaderboard-btn"
            >
              Következő
            </Button>
          </div>
        </>
      )}
    </Container>
  );
};
