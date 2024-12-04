import React, { useState } from "react";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";
import { Link, useNavigate } from "react-router";
import axios from "axios";
import "./Register.css"; // Updated styles with background image

export const Register = () => {
  
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);

  const navigate = useNavigate();

  function validateForm() {
    return email.length > 0 && password.length > 0 && name.length > 0;
  }

  async function handleRegister(event) {
    event.preventDefault();

    try {
      const response = await axios.post("http://localhost:4000/register", {
        email,
        name,
        password,
      });

      const token = response?.data?.token;

      if (token) {
        window.localStorage.setItem("accessToken", token);
        navigate("/");
      } else {
        setError("Server error.");
      }
    } catch (error) {
      setError("Registering failed. Please try again.");
    }
  }

  return (
    <div className="Register">
      <Link to="/" className="menu-title">
        Römi
      </Link>
      <Form className="register-form" onSubmit={handleRegister}>
        <Form.Group size="lg" controlId="fullName">
          <Form.Label>Név</Form.Label>
          <Form.Control
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Group>
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
          Regisztráció
        </Button>
        {error && <p className="text-danger mt-3">{error}</p>}
      </Form>
      <div className="login-link">
        <Link to="/login" className="btn btn-outline-secondary">
          Belépés
        </Link>
      </div>
    </div>
  );
};
