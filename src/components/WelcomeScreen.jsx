import { Link } from 'react-router-dom'
import { useStore } from '../lib/store'

export default function WelcomeScreen() {
  const notes = useStore((s) => s.notes)
  const recent = notes.slice(0, 5)

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 md:p-12 text-center">
      <div className="w-16 h-16 rounded-2xl bg-accent/20 flex items-center justify-center mb-6">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">Welcome to IntraNotes</h2>
      <p className="text-ink-muted text-sm max-w-md mb-8">
        Open the <span className="text-ink">menu</span> to choose a note, or tap the <span className="text-ink">search</span> icon
        <span className="hidden md:inline"> (or press <kbd className="bg-surface-2 border border-surface-3 rounded px-1.5 py-0.5 text-xs font-mono">⌘K</kbd>)</span>.
      </p>

      {recent.length > 0 && (
        <div className="w-full max-w-sm text-left">
          <p className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-3">Recently updated</p>
          <div className="space-y-1">
            {recent.map((n) => (
              <Link key={n.id} to={`/note/${n.id}`}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors group">
                <span className="text-ink-faint text-lg">📄</span>
                <span className="flex-1 text-sm text-ink truncate group-hover:text-white">{n.title || 'Untitled'}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
