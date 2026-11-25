import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './views/App';
import 'bootstrap/dist/css/bootstrap.min.css';
import './index.css';
import { connectSocket } from './socket';

// Reconnect socket if user already has a session from a previous visit
connectSocket();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
