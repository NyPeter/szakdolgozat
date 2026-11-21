import { io } from 'socket.io-client';

let socket = null;

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

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function getSocket() {
  return socket;
}
