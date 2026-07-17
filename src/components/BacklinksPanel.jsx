import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link2, Loader2 } from 'lucide-react'
import { fetchBacklinks } from '../lib/supabase'

export default function BacklinksPanel({ noteId }) {
  const navigate = useNavigate()
  const [backlinks, setBacklinks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!noteId) return
    setLoading(true)
    fetchBacklinks(noteId)
      .then(setBacklinks)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [noteId])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-2">
        <Link2 size={15} className="text-accent" />
        <h3 className="text-sm font-semibold text-white">Backlinks</h3>
        {!loading && (
          <span className="ml-auto text-xs text-ink-faint bg-surface-2 rounded-full px-2 py-0.5">{backlinks.length}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={18} className="animate-spin text-ink-faint" />
          </div>
        ) : backlinks.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-ink-faint text-sm">No notes link here yet.</div>
            <div className="text-ink-faint text-xs mt-1">Use [[This Note Title]] in another note.</div>
          </div>
        ) : (
          <div className="space-y-1">
            {backlinks.map((bl) => {
              const sourceNote = bl.notes
              return (
                <button
                  key={bl.id}
                  onClick={() => navigate(`/note/${sourceNote.id}`)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors group"
                >
                  <div className="text-sm text-ink group-hover:text-white truncate">{sourceNote.title || 'Untitled'}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
