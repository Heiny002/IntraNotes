import { useState, useRef } from 'react'
import { Wand2, Loader2, X, Tag, Link2 } from 'lucide-react'
import { useStore } from '../lib/store'
import { organizeVault } from '../lib/librarian'
import toast from 'react-hot-toast'

export default function OrganizeVaultModal() {
  const { notes, closeOrganize } = useStore()
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState({ total: notes.length, processed: 0, tagsAdded: 0, linksAdded: 0, errors: 0 })
  const cancelRef = useRef(false)

  async function run() {
    cancelRef.current = false
    setRunning(true)
    setDone(false)
    const summary = await organizeVault({
      onProgress: (p) => setProgress(p),
      shouldCancel: () => cancelRef.current,
    })
    setProgress(summary)
    setRunning(false)
    setDone(true)
    toast.success(`Organized ${summary.processed} notes · +${summary.tagsAdded} tags · +${summary.linksAdded} links`)
  }

  const pct = progress.total ? Math.round((progress.processed / progress.total) * 100) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-20"
      onClick={() => { if (!running) closeOrganize() }}
    >
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl border border-surface-2 bg-surface-1 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-2">
          <Wand2 size={16} className="text-accent" />
          <h3 className="flex-1 text-white font-semibold text-sm">Organize vault</h3>
          {!running && (
            <button onClick={closeOrganize} className="text-ink-faint hover:text-ink"><X size={16} /></button>
          )}
        </div>

        <div className="p-4 space-y-4">
          {!running && !done && (
            <p className="text-sm text-ink-muted">
              The librarian will read all <span className="text-ink">{notes.length}</span> of your notes and
              automatically <span className="text-ink">tag</span> them and
              add <span className="text-ink">[[wiki-links]]</span> where one note mentions another.
              Tags you added by hand are kept. This runs one note at a time and can take a little while.
            </p>
          )}

          {(running || done) && (
            <>
              <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
                <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="text-xs text-ink-muted">
                {progress.processed} / {progress.total} notes
                {running && progress.current && <span className="text-ink-faint truncate"> · {progress.current}</span>}
              </div>
              <div className="flex gap-4 text-sm">
                <span className="flex items-center gap-1.5 text-ink"><Tag size={13} className="text-accent" /> {progress.tagsAdded} tags</span>
                <span className="flex items-center gap-1.5 text-ink"><Link2 size={13} className="text-accent" /> {progress.linksAdded} links</span>
                {progress.errors > 0 && <span className="text-yellow-500">{progress.errors} skipped</span>}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-surface-2">
          {!running && !done && (
            <>
              <button onClick={closeOrganize} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Cancel</button>
              <button onClick={run} disabled={!notes.length}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40">
                <Wand2 size={14} /> Start
              </button>
            </>
          )}
          {running && (
            <button onClick={() => { cancelRef.current = true }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-ink text-sm">
              <Loader2 size={14} className="animate-spin" /> Stop after current
            </button>
          )}
          {done && (
            <button onClick={closeOrganize} className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium">Done</button>
          )}
        </div>
      </div>
    </div>
  )
}
