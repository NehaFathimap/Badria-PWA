import { createRoot } from 'react-dom/client'
import React from 'react';
import { registerSW } from 'virtual:pwa-register';
import './index.css'
import App from './App.jsx'

// Register service worker only in production
// In development, unregister any existing service workers to avoid conflicts with proxy
if (import.meta.env.PROD) {
  const updateSW = registerSW({
    onNeedRefresh() {
      // Show update notification
      if (confirm('New version available! Click OK to update.')) {
        updateSW(true);
      }
    },
    onOfflineReady() {
    },
    onRegistered(registration) {
    },
    onRegisterError(error) {
      console.error('Service Worker registration error:', error);
    }
  });
} else {
  // In development, unregister any existing service workers
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister().then(() => {
        });
      });
    });
  }
}

import { BrowserRouter } from 'react-router-dom'

// BrowserRouter for clean URLs (pwa/quotations instead of #/quotations)
// Basename matches the app's base path
const basename = import.meta.env.VITE_APP_BASE_PATH || '/assets/badria_pwa/pwa';
createRoot(document.getElementById('root')).render(
  <BrowserRouter basename={basename}>
    <App/>
  </BrowserRouter>
)
