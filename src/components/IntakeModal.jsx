import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Link as LinkIcon, Loader2, X, ClipboardPaste } from 'lucide-react'
import { useStore } from '../lib/store'
import { createNoteFromText, createNoteFromUrl, isUrl } from '../lib/intake'
import FolderPicker from './FolderPicker'
import toast from 'react-hot-toast'

function defaultFolderId(folders) {
  const uploads = folders.find((f) => f.name === 'Uploads' && !f.parent_id)
  if (uploads) return uploads.id
  const root = folders.find((f) => !f.parent_id)
  return root ? root.id : null
}

export default function IntakeModal() {
  const navigate = useNavigate()
  const { intakePrefill, closeIntake } = useStore()
  const folders = useStore((s) => s.folders)
  const [mode, setMode] = useState(intakePrefill?.mode || 'text')
  const [noteTitle, setNoteTitle] = useState('')
  const [text, setText] = useState(intakePrefill?.mode === 'text' ? (intakePrefill?.value || '') : '')
  const [url, setUrl] = useState(intakePrefill?.mode === 'url' ? (intakePrefill?.value || '') : '')
  const [folderId, setFolderId] = useState(() => defaultFolderId(folders))
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // Fill in the default folder once folders have loaded.
  useEffect(() => {
    if (folderId == null && folders.length) setFolderId(defaultFolderId(folders))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders])

  useEffect(() => { inputRef.current?.focus() }, [mode])
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) closeIntake() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, closeIntake])

  async function pasteFromClipboard() {
    try {
      const clip = await navigator.clipboard.readText()
      if (!clip) { toast('Clipboard is empty'); return }
      if (isUrl(clip)) { setMode('url'); setUrl(clip.trim()) }
      else { setMode('text'); setText(clip) }
    } catch {
      toast.error('Couldn’t read clipboard — paste manually with ⌘V')
    }
  }

  async function submit(e) {
    e?.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      let note
      if (mode === 'url') {
        const t = toast.loading('Fetching & saving…')
        const res = await createNoteFromUrl(url, folderId)
        note = res.note
        toast.dismiss(t)
        toast.success(res.scraped ? 'Article saved & summarized' : 'Saved (link only)')
      } else {
        note = await createNoteFromText(text, noteTitle, folderId)
        toast.success('Note saved')
      }
      closeIntake()
      navigate(`/note/${note.id}`)
    } catch (err) {
      toast.error(err.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = mode === 'url' ? isUrl(url) : text.trim().length > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-20"
      onClick={() => !busy && closeIntake()}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl border border-surface-2 bg-surface-1 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-2">
          <h3 className="text-white font-semibold text-sm flex-1">Add to IntraNotes</h3>
          <button type="button" onClick={pasteFromClipboard}
            className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink px-2 py-1 rounded hover:bg-surface-2">
            <ClipboardPaste size={13} /> Paste
          </button>
          <button type="button" onClick={() => !busy && closeIntake()} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 px-3 pt-3">
          <TabButton active={mode === 'text'} onClick={() => setMode('text')} icon={<FileText size={14} />} label="Paste text" />
          <TabButton active={mode === 'url'} onClick={() => setMode('url')} icon={<LinkIcon size={14} />} label="From URL" />
        </div>

        <div className="p-3">
          {mode === 'text' ? (
            <div className="space-y-2">
              <input
                type="text"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                maxLength={100}
                placeholder="Title (optional — defaults to the first line)"
                className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm font-medium text-ink outline-none focus:ring-2 focus:ring-accent placeholder-ink-faint"
              />
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Write or paste the note body here…"
                rows={8}
                className="w-full resize-y rounded-lg border border-surface-3 bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:ring-2 focus:ring-accent placeholder-ink-faint"
              />
            </div>
          ) : (
            <>
              <input
                ref={inputRef}
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/article  (or an x.com post)"
                className="w-full rounded-lg border border-surface-3 bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-accent placeholder-ink-faint"
              />
              <p className="mt-2 text-xs text-ink-faint">
                The page is scraped, summarized, and tagged automatically.
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-surface-2">
          <span className="text-xs text-ink-faint shrink-0">Save to</span>
          <FolderPicker folders={folders} value={folderId} onChange={setFolderId} up />
          <div className="flex-1" />
          <button type="button" onClick={() => !busy && closeIntake()} className="px-3 py-2 text-sm text-ink-muted hover:text-ink">Cancel</button>
          <button
            type="submit"
            disabled={!canSubmit || busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {mode === 'url' ? 'Save article' : 'Create note'}
          </button>
        </div>
      </form>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
        active ? 'bg-surface-2 text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-2/50'
      }`}
    >
      {icon} {label}
    </button>
  )
}
