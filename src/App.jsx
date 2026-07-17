import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useStore } from './lib/store'
import AuthPage from './pages/AuthPage'
import MainLayout from './pages/MainLayout'

export default function App() {
  const { session, authReady, setSession } = useStore()

  useEffect(() => {
    // Hydrate session
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [setSession])

  // Show the loading spinner only until the first session check resolves.
  if (!authReady) {
    return (
      <div className="h-screen bg-surface-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/auth" element={!session ? <AuthPage /> : <Navigate to="/" replace />} />
      <Route path="/*" element={session ? <MainLayout /> : <Navigate to="/auth" replace />} />
    </Routes>
  )
}
