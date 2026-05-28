import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import initNative from './lib/native.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Initialize Capacitor native plugins (no-op on web)
initNative()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
}

// Global error handler — surfaces uncaught promise rejections in console
window.addEventListener('unhandledrejection', (e) => {
  console.error('[PlanLess] Unhandled rejection:', e.reason)
})
