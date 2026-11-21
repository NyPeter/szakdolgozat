import { useState, useEffect } from 'react';
import { Button, Container } from 'react-bootstrap';
import axios from 'axios';
import './Menu.css';

const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const Menu = () => {
  const token = localStorage.getItem('accessToken');
  const isLoggedIn = !!token;
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!token) return;
    axios
      .get(`${api}/user`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setIsAdmin(!!res.data.user?.isAdmin))
      .catch(() => {});
  }, [token]);

  const logOut = () => {
    localStorage.removeItem('accessToken');
    window.location.reload();
  };

  return (
    <Container fluid className="menu-container">
      <h1 className="menu-title">Römi</h1>

      {!isLoggedIn && (
        <>
          <Button variant="success" href="/Login" className="menu-button">
            Belépés
          </Button>
          <Button variant="success" href="/Register" className="menu-button">
            Regisztráció
          </Button>
        </>
      )}
      {isLoggedIn && (
        <>
          <Button variant="success" href="/Games" className="menu-button">
            Szobák
          </Button>
          <Button variant="success" href="/LeaderBoard" className="menu-button">
            Ranglista
          </Button>
          <Button variant="success" href="/Profile" className="menu-button">
            Profil
          </Button>
          {isAdmin && (
            <Button variant="outline-warning" href="/Admin" className="menu-button">
              Admin
            </Button>
          )}
          <Button variant="outline-success" onClick={logOut} className="menu-button">
            Kijelentkezés
          </Button>
        </>
      )}
    </Container>
  );
};
