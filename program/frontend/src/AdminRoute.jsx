import { useState, useEffect } from 'react';
import { Navigate } from 'react-router';
import axios from 'axios';

const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const AdminRoute = ({ children }) => {
  const token = localStorage.getItem('accessToken');
  const [status, setStatus] = useState('loading'); // 'loading' | 'ok' | 'deny'

  useEffect(() => {
    if (!token) { setStatus('deny'); return; }
    axios
      .get(`${api}/user`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setStatus(res.data.user?.isAdmin ? 'ok' : 'deny'))
      .catch(() => setStatus('deny'));
  }, [token]);

  if (status === 'loading') return null;
  if (status === 'deny') return <Navigate to="/" />;
  return children;
};
