import { useState } from 'react';
import Form from 'react-bootstrap/Form';
import Button from 'react-bootstrap/Button';
import Alert from 'react-bootstrap/Alert';
import { Link, useNavigate } from 'react-router';
import axios from 'axios';
import { connectSocket } from '../../socket';
import './Register.css';

/**
 * Registration form. On success the token is saved and the socket connects.
 *
 * @returns {object} The page.
 */
export const Register = () => {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const navigate = useNavigate();
  const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  // Only enables the button; the server checks the email format and password length.
  function validateForm() {
    return email.length > 0 && password.length > 0 && name.length > 0;
  }

  async function handleRegister(event) {
    event.preventDefault();
    setError(null);

    try {
      const response = await axios.post(`${api}/register`, {
        email,
        name,
        password,
      });

      const token = response?.data?.token;

      if (token) {
        window.localStorage.setItem('accessToken', token);
        connectSocket();
        navigate('/');
      } else {
        setError('Szerverhiba történt, próbáld újra később.');
      }
    } catch (err) {
      setError(err.response?.data?.message ?? 'Nem sikerült elérni a szervert, próbáld újra.');
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
        {error && (
          <Alert variant="danger" className="mt-3" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
      </Form>
      <div className="login-link">
        <Link to="/login" className="btn btn-outline-secondary">
          Belépés
        </Link>
      </div>
    </div>
  );
};
