import { useState } from 'react';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import Alert from 'react-bootstrap/Alert';
import { Link, useNavigate } from 'react-router';
import axios from 'axios';
import { connectSocket } from '../../socket';
import './Login.css';

export const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const navigate = useNavigate();
  const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  function validateForm() {
    return email.length > 0 && password.length > 0;
  }

  async function handleLogin(event) {
    event.preventDefault();
    setError(null);

    try {
      const response = await axios.post(`${api}/login`, {
        email,
        password,
      });

      const token = response?.data?.token;

      if (token) {
        window.localStorage.setItem('accessToken', token);
        connectSocket();
        navigate('/');
      } else {
        setError('Hibás belépési adatok.');
      }
    } catch (err) {
      setError(err.response?.data?.message ?? 'Nem sikerült elérni a szervert, próbáld újra.');
    }
  }

  return (
    <div className="Login">
      <Button variant="secondary" href="/" className="leaderboard-back-btn">
        Vissza a Menübe
      </Button>
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
        {error && (
          <Alert variant="danger" className="mt-3" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </Form>
      <div className="register-link">
        <Link to="/register" className="btn btn-outline-secondary">
          Regisztráció
        </Link>
      </div>
    </div>
  );
};
