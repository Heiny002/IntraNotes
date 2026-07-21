import { useState, useRef, useEffect } from 'react'
import { Folder, ChevronDown, Check } from 'lucide-react'
import { flattenFolders } from '../lib/folders'

/**
 * Compact "move to folder" dropdown. Shows the current folder; opens a
 * depth-indented list of all folders (so nested folders are visible).
 */
export default function FolderPicker({ folders, value, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const flat = flattenFolders(folders)
  const current = folders.find((f) => f.id === value)

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Move to folder"
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-ink-muted hover:text-ink hover:bg-surface-2 max-w-[45vw] md:max-w-[180px]"
      >
        <Folder size={14} className="shrink-0" />
        <span className="truncate">{current?.name || 'No folder'}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 max-h-72 overflow-y-auto rounded-lg border border-surface-2 bg-surface-1 shadow-2xl py-1 z-50">
          {flat.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { onChange(f.id); setOpen(false) }}
              style={{ paddingLeft: 8 + f.depth * 14 }}
              className={`w-full flex items-center gap-2 pr-3 py-1.5 text-left text-sm ${
                f.id === value ? 'text-white bg-surface-2' : 'text-ink-muted hover:bg-surface-2/60'
              }`}
            >
              <Folder size={13} className="text-ink-faint shrink-0" />
              <span className="flex-1 truncate">{f.name}</span>
              {f.id === value && <Check size={13} className="text-accent shrink-0" />}
            </button>
          ))}
          {flat.length === 0 && <div className="px-3 py-2 text-xs text-ink-faint">No folders yet</div>}
        </div>
      )}
    </div>
  )
}
