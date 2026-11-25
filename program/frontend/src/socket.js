import { io } from 'socket.io-client';

let socket = null;

/**
 * Opens the shared Socket.IO connection with the saved token (if logged in).
 */
export function connectSocket() {
  const token = localStorage.getItem('accessToken');
  if (!token) return;

  socket = io('http://localhost:4000', {
    auth: { token },
    transports: ['websocket'],
  });

  // Dev-only handle for the browser console (game:devPreset); the underscore marks it as internal.
  // eslint-disable-next-line no-underscore-dangle
  if (import.meta.env.DEV) window._socket = socket;
}

/**
 * Closes the shared connection (logout, account deletion).
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * @returns {object|null} The shared connection, or null when not logged in.
 */
export function getSocket() {
  return socket;
}
