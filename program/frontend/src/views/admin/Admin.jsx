import { useState, useEffect, useCallback } from 'react';
import {
  Alert, Button, Container, Table, Form, InputGroup,
} from 'react-bootstrap';
import axios from 'axios';
import { useNavigate } from 'react-router';

function formatDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (d <= new Date()) return '–';
  return d.toLocaleDateString('hu-HU');
}

function ActionCell({
  userId, field, currentValue, onDone, onError,
}) {
  const [days, setDays] = useState('');
  const [loading, setLoading] = useState(false);

  const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';

  const endpoint = `${api}/admin/user/${userId}/${field}`;
  const token = localStorage.getItem('accessToken');
  const headers = { Authorization: `Bearer ${token}` };

  const send = async (daysValue) => {
    setLoading(true);
    onError('');
    try {
      await axios.put(endpoint, { days: daysValue }, { headers });
      onDone();
    } catch (err) {
      onError(err.response?.data?.message ?? 'Nem sikerült elérni a szervert, próbáld újra.');
    } finally {
      setLoading(false);
      setDays('');
    }
  };

  const isActive = currentValue && new Date(currentValue) > new Date();

  return (
    <div className="d-flex flex-column gap-1">
      <small className="text-muted">{formatDate(currentValue)}</small>
      <InputGroup size="sm" style={{ width: 240 }}>
        <Form.Control
          type="number"
          min={1}
          placeholder="napok"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          disabled={loading}
        />
        <Button
          variant="outline-warning"
          disabled={loading || !days || Number(days) < 1}
          onClick={() => send(Number(days))}
        >
          Beállítás
        </Button>
        <Button
          variant="outline-danger"
          disabled={loading}
          title="Végleges"
          onClick={() => send(-1)}
        >
          ∞
        </Button>
        {isActive && (
          <Button
            variant="outline-success"
            disabled={loading}
            onClick={() => send(0)}
          >
            Feloldás
          </Button>
        )}
      </InputGroup>
    </div>
  );
}

export const Admin = () => {
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [actionError, setActionError] = useState('');
  const navigate = useNavigate();

  const fetchUsers = useCallback(async (p, name) => {
    try {
      const token = localStorage.getItem('accessToken');
      const headers = { Authorization: `Bearer ${token}` };
      const params = name ? { name } : {};
      const res = await axios.get(`http://localhost:4000/admin/users/${p}`, { headers, params });
      setUsers(res.data.users);
      setPages(res.data.pages);
    } catch {
      navigate('/');
    }
  }, [navigate]);

  useEffect(() => { fetchUsers(page, search); }, [fetchUsers, page, search]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  return (
    <Container className="mt-4">
      <div className="d-flex align-items-center gap-3 mb-3">
        <Button variant="secondary" onClick={() => navigate('/')}>← Vissza</Button>
        <h3 className="mb-0">Admin – Felhasználók</h3>
      </div>

      <Form onSubmit={handleSearch} className="d-flex gap-2 mb-3">
        <Form.Control
          type="text"
          placeholder="Keresés név alapján..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ maxWidth: 300 }}
        />
        <Button type="submit" variant="primary">Keresés</Button>
        {search && (
          <Button variant="outline-secondary" onClick={handleClearSearch}>Törlés</Button>
        )}
      </Form>

      {actionError && (
        <Alert variant="danger" dismissible onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      <Table bordered hover responsive size="sm">
        <thead>
          <tr>
            <th>#</th>
            <th>Név</th>
            <th>Email</th>
            <th>Felfüggesztés</th>
            <th>Némítás</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.isAdmin ? 'table-info' : ''}>
              <td>{u.id}</td>
              <td>{u.name}{u.isAdmin && <span className="ms-1 badge bg-primary">admin</span>}</td>
              <td>{u.email}</td>
              <td>
                {u.isAdmin ? '–' : (
                  <ActionCell
                    userId={u.id}
                    field="suspend"
                    currentValue={u.suspendedUntil}
                    onDone={() => fetchUsers(page, search)}
                    onError={setActionError}
                  />
                )}
              </td>
              <td>
                {u.isAdmin ? '–' : (
                  <ActionCell
                    userId={u.id}
                    field="mute"
                    currentValue={u.mutedUntil}
                    onDone={() => fetchUsers(page, search)}
                    onError={setActionError}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="d-flex gap-2">
        <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{'<'}</Button>
        <span className="align-self-center">{page} / {pages}</span>
        <Button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{'>'}</Button>
      </div>
    </Container>
  );
};
