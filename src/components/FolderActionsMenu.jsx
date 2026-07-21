import { useState, useRef, useEffect } from 'react'
import {
  MoreHorizontal, FilePlus, FolderPlus, Pencil, FolderInput, Trash2,
  ChevronLeft, Folder, CornerUpLeft,
} from 'lucide-react'
import { flattenFolders, getDescendantIds } from '../lib/folders'

/**
 * "⋯" actions menu for a folder: new note/subfolder, rename, move (reparent),
 * delete. The Move view lists valid destinations (excludes the folder itself
 * and its descendants) plus "Top level".
 */
export default function FolderActionsMenu({ folder, folders, onNewNote, onNewFolder, onRename, onMove, onDelete }) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('menu')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setView('menu') } }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => { setOpen(false); setView('menu') }
  const descendants = getDescendantIds(folder.id, folders)
  const destinations = flattenFolders(folders).filter(
    (f) => f.id !== folder.id && !descendants.has(f.id) && f.id !== folder.parent_id
  )

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); setView('menu') }}
        title="Folder actions"
        className="p-0.5 rounded hover:bg-surface-3 text-ink-muted hover:text-ink"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-48 max-h-72 overflow-y-auto rounded-lg border border-surface-2 bg-surface-1 shadow-2xl py-1 z-50 text-sm"
          onClick={(e) => e.stopPropagation()}
        >
          {view === 'menu' ? (
            <>
              <Item icon={<FilePlus size={14} />} label="New note" onClick={() => { onNewNote(); close() }} />
              <Item icon={<FolderPlus size={14} />} label="New subfolder" onClick={() => { onNewFolder(); close() }} />
              <Divider />
              <Item icon={<Pencil size={14} />} label="Rename" onClick={() => { onRename(); close() }} />
              <Item icon={<FolderInput size={14} />} label="Move to…" onClick={() => setView('move')} />
              <Divider />
              <Item icon={<Trash2 size={14} />} label="Delete" danger onClick={() => { onDelete(); close() }} />
            </>
          ) : (
            <>
              <button onClick={() => setView('menu')} className="w-full flex items-center gap-2 px-3 py-1.5 text-ink-faint hover:text-ink">
                <ChevronLeft size={14} /> Back
              </button>
              <Divider />
              {folder.parent_id && (
                <Item icon={<CornerUpLeft size={14} />} label="Top level" onClick={() => { onMove(null); close() }} />
              )}
              {destinations.map((d) => (
                <button
                  key={d.id}
                  onClick={() => { onMove(d.id); close() }}
                  style={{ paddingLeft: 12 + d.depth * 12 }}
                  className="w-full flex items-center gap-2 pr-3 py-1.5 text-left text-ink-muted hover:bg-surface-2/60 hover:text-ink"
                >
                  <Folder size={13} className="text-ink-faint shrink-0" />
                  <span className="truncate">{d.name}</span>
                </button>
              ))}
              {destinations.length === 0 && !folder.parent_id && (
                <div className="px-3 py-2 text-xs text-ink-faint">Nowhere else to move</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Item({ icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-2 ${danger ? 'text-red-400' : 'text-ink-muted hover:text-ink'}`}
    >
      {icon}{label}
    </button>
  )
}

function Divider() {
  return <div className="my-1 border-t border-surface-2" />
}
