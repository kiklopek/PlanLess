import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './contexts/AuthContext.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'

const Landing    = lazy(() => import('./pages/Landing.jsx'))
const Login      = lazy(() => import('./pages/Login.jsx'))
const Register   = lazy(() => import('./pages/Register.jsx'))
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'))
const Dashboard  = lazy(() => import('./pages/Dashboard.jsx'))
const Payment    = lazy(() => import('./pages/Payment.jsx'))

function App() {
  return (
    <AuthProvider>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--paper)',
            color: 'var(--ink)',
            border: '1px solid var(--line)',
            fontFamily: 'inherit',
            fontSize: 14,
          },
        }}
      />
      <BrowserRouter>
        <Suspense fallback={<div className="loader">Načítám PlanLess…</div>}>
          <Routes>
            <Route path="/"           element={<Landing />} />
            <Route path="/login"      element={<Login />} />
            <Route path="/register"   element={<Register />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/payment"    element={<Payment />} />
            <Route path="/app"        element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="*"           element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
