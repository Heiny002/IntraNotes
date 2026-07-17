import { useState } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function AuthPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleMagicLink(e) {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setLoading(false)
    if (error) { toast.error(error.message); return }
    setSent(true)
    toast.success('Check your email for the magic link!')
  }

  return (
    <div className="h-screen bg-surface-0 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">IntraNotes</h1>
          <p className="text-ink-muted mt-1 text-sm">Your personal knowledge base</p>
        </div>

        {sent ? (
          <div className="bg-surface-2 rounded-xl p-6 text-center border border-surface-3">
            <div className="text-3xl mb-3">✉️</div>
            <h2 className="text-white font-semibold mb-2">Magic link sent!</h2>
            <p className="text-ink-muted text-sm">Check your inbox at <span className="text-ink">{email}</span> and click the link to sign in.</p>
            <button onClick={() => setSent(false)} className="mt-4 text-sm text-accent hover:underline">Use a different email</button>
          </div>
        ) : (
          <form onSubmit={handleMagicLink} className="bg-surface-2 rounded-xl p-6 border border-surface-3 space-y-4">
            <div>
              <label className="block text-sm font-medium text-ink-muted mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
                className="w-full bg-surface-3 border border-surface-3 rounded-lg px-3 py-2.5 text-ink placeholder-ink-faint focus:outline-none focus:ring-2 focus:ring-accent text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-accent-hover text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm"
            >
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
            <p className="text-xs text-ink-faint text-center">No password needed — we'll email you a sign-in link.</p>
          </form>
        )}
      </div>
    </div>
  )
}
