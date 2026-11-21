import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert, Container, Form, Button, Spinner, Modal,
} from 'react-bootstrap';
import './Profile.css';

const api = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export const Profile = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Used only for cache-busting avatar URL
  const [avatarVersion, setAvatarVersion] = useState(Date.now());

  const [editData, setEditData] = useState({
    name: '',
    email: '',
    currentPassword: '',
    newPassword: '',
  });

  const [avatarFile, setAvatarFile] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');

  const [avatarError, setAvatarError] = useState('');
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB

  // Result of the last action, shown under the section it belongs to:
  // { section: 'avatar' | 'profile' | 'password' | 'delete', variant: 'success' | 'danger', text }
  const [notice, setNotice] = useState(null);
  const showError = (section, err, fallback) => setNotice({
    section, variant: 'danger', text: err.response?.data?.message ?? fallback,
  });
  const renderNotice = (section) => notice?.section === section && (
    <Alert variant={notice.variant} className="mt-2" dismissible onClose={() => setNotice(null)}>
      {notice.text}
    </Alert>
  );

  const token = localStorage.getItem('accessToken');

  const loadUser = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${api}/user`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setUser(data.user);
      setEditData({
        name: data.user.name,
        email: data.user.email,
        currentPassword: '',
        newPassword: '',
      });

      // force fresh avatar load
      setAvatarVersion(Date.now());
    } catch (err) {
      console.error('Load user error:', err);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const saveProfile = async () => {
    setNotice(null);
    try {
      const payload = {
        name: editData.name,
        email: editData.email,
      };

      const { data } = await axios.put(`${api}/user`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setUser(data);
      setNotice({ section: 'profile', variant: 'success', text: 'A profil frissült.' });
    } catch (err) {
      console.error('Update error:', err);
      showError('profile', err, 'Nem sikerült elérni a szervert, próbáld újra.');
    }
  };

  const savePassword = async () => {
    setNotice(null);
    try {
      const payload = {
        currentPassword: editData.currentPassword,
        newPassword: editData.newPassword,
      };
      const { data } = await axios.put(`${api}/user/password`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setEditData((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
      setNotice({ section: 'password', variant: 'success', text: data.message });
    } catch (err) {
      console.error('Update error:', err);
      showError('password', err, 'Nem sikerült elérni a szervert, próbáld újra.');
    }
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];

    if (!file) {
      setAvatarFile(null);
      setAvatarError('');
      return;
    }

    const allowed = ['image/png', 'image/jpeg', 'image/jpg'];

    if (!allowed.includes(file.type)) {
      setAvatarError('Csak PNG vagy JPG fájl tölthető fel.');
      setAvatarFile(null);
      return;
    }

    if (file.size > MAX_SIZE) {
      setAvatarError('A fájl mérete nem lehet nagyobb 5MB-nál.');
      setAvatarFile(null);
      return;
    }

    // Valid file
    setAvatarFile(file);
    setAvatarError('');
  };

  const uploadAvatar = async () => {
    setNotice(null);
    if (!avatarFile) {
      setNotice({ section: 'avatar', variant: 'danger', text: 'Nem választottál ki képet.' });
      return;
    }

    const formData = new FormData();
    formData.append('file', avatarFile);

    try {
      const { data } = await axios.post(`${api}/user/avatar`, formData, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
      });

      setUser((prev) => ({ ...prev, avatarURL: data.avatarURL }));
      setAvatarVersion(Date.now()); // <-- force fresh image URL

      setNotice({ section: 'avatar', variant: 'success', text: 'Az avatar frissült.' });
    } catch (err) {
      console.error('Avatar upload error:', err);
      showError('avatar', err, 'Nem sikerült elérni a szervert, próbáld újra.');
    }
  };

  const deleteAccount = async () => {
    setNotice(null);
    try {
      await axios.delete(`${api}/user`, {
        data: { password: deletePassword },
        headers: { Authorization: `Bearer ${token}` },
      });

      localStorage.removeItem('accessToken');
      window.location.href = '/';
    } catch (err) {
      console.error('Delete error:', err);
      showError('delete', err, 'Nem sikerült elérni a szervert, próbáld újra.');
    }
  };

  if (loading || !user) {
    return (
      <Container className="profile-container">
        <Spinner animation="border" variant="danger" />
      </Container>
    );
  }

  return (
    <Container className="profile-container">
      <Button variant="secondary" href="/" className="leaderboard-back-btn">
        Vissza a Menübe
      </Button>
      <h1 className="profile-title">Profil</h1>

      <div className="profile-section">
        <img
          src={`${api}${user.avatarURL}?v=${avatarVersion}`}
          alt="avatar"
          className="profile-avatar"
        />

        <Form.Group className="mt-3">
          <Form.Label>Új avatar</Form.Label>
          <Form.Control
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            className={avatarError ? 'is-invalid' : ''}
          />
          {avatarError && (
            <small className="text-danger">{avatarError}</small>
          )}
          <Button variant="success" className="mt-2" onClick={uploadAvatar} disabled={!avatarFile || avatarError}>
            Avatar feltöltése
          </Button>
          {renderNotice('avatar')}
        </Form.Group>
      </div>

      <Form className="profile-form">
        <Form.Group>
          <Form.Label>Név</Form.Label>
          <Form.Control
            type="text"
            value={editData.name}
            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
          />
        </Form.Group>

        <Form.Group>
          <Form.Label>Email</Form.Label>
          <Form.Control
            type="email"
            value={editData.email}
            onChange={(e) => setEditData({ ...editData, email: e.target.value })}
          />
        </Form.Group>

        <Button variant="success" className="mt-3" onClick={saveProfile}>
          Mentés
        </Button>
        {renderNotice('profile')}

        <Form.Group className="mt-3">
          <Form.Label>Jelenlegi jelszó</Form.Label>
          <Form.Control
            type="password"
            value={editData.currentPassword}
            onChange={(e) => setEditData({ ...editData, currentPassword: e.target.value })
            }
          />
        </Form.Group>

        <Form.Group>
          <Form.Label>Új jelszó</Form.Label>
          <Form.Control
            type="password"
            value={editData.newPassword}
            onChange={(e) => setEditData({ ...editData, newPassword: e.target.value })
            }
          />
        </Form.Group>

        <Button variant="success" className="mt-3" onClick={savePassword}>
          Jelszó módosítása
        </Button>
        {renderNotice('password')}
      </Form>

      <Button variant="outline-danger" onClick={() => setShowDeleteModal(true)}>
        Fiók törlése
      </Button>

      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Fiók törlése</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>Biztosan törölni szeretnéd a fiókodat?</p>
          <Form.Control
            type="password"
            placeholder="Jelszó megerősítés"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
          />
          {renderNotice('delete')}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Mégse
          </Button>
          <Button variant="danger" onClick={deleteAccount}>
            Törlés
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};
