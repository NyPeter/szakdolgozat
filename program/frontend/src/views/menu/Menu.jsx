import React from 'react';
import { Button, Container } from 'react-bootstrap';
import './Menu.css';

export const Menu = () => {
  const isLoggedIn = localStorage.getItem("accessToken") ? true : false;

  const logOut = () => {
    localStorage.removeItem("accessToken");
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
          <Button variant="outline-success" onClick={logOut} className="menu-button">
            Kijelentkezés
          </Button>
        </>
      )}
    </Container>
  );
};
