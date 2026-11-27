import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// Production only: in development the worker would keep serving old files while you edit.
// Not in the iPhone app (vite build --mode ios): it carries its own files, and its web view doesn't run workers
if (import.meta.env.PROD && import.meta.env.MODE !== 'ios' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
