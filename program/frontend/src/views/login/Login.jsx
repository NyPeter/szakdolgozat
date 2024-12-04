import React, { useState } from "react";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { Link, useNavigate } from "react-router";
import axios from "axios";
import "./Login.css"; // Updated styles with background image

export const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  const navigate = useNavigate();

  function validateForm() {
    return email.length > 0 && password.length > 0;
  }

  async function handleLogin(event) {
    event.preventDefault();

    try {
      const response = await axios.post("http://localhost:4000/login", {
        email,
        password,
      });

      const token = response?.data?.token;

      if (token) {
        window.localStorage.setItem("accessToken", token);
        navigate("/");
      } else {
        setError("Invalid credentials or server error.");
      }
    } catch (error) {
      setError("Login failed. Please try again.");
    }
  }

  return (
    <div className="Login">
      <Link to="/" className="menu-title">
        Römi
      </Link>
      <Form className="login-form" onSubmit={handleLogin}>
        <Form.Group size="lg" controlId="email">
          <Form.Label>Email</Form.Label>
          <Form.Control
            autoFocus
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Form.Group>
        <Form.Group size="lg" controlId="password">
          <Form.Label>Jelszó</Form.Label>
          <Form.Control
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Form.Group>
        <Button size="lg" type="submit" disabled={!validateForm()}>
          Belépés
        </Button>
        {error && <p className="text-danger mt-3">{error}</p>}
      </Form>
      <div className="register-link">
        <Link to="/register" className="btn btn-outline-secondary">
          Regisztráció
        </Link>
      </div>
    </div>
  );
};
