import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronRight, ChevronDown, FolderPlus, FilePlus,
  LayoutDashboard, Tag, GitBranch, LogOut, WifiOff,
  Menu, Plus, Wand2
} from 'lucide-react'
import { useStore } from '../lib/store'
import { createFolder, deleteNote } from '../lib/supabase'
import { enqueueOutbox } from '../lib/offline'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

// On mobile the sidebar is an overlay drawer — close it after navigating so the
// content underneath is visible.
function closeDrawerIfMobile() {
  if (typeof window !== 'undefined' && window.innerWidth < 768) {
    useStore.getState().setSidebarOpen(false)
  }
}

function FolderNode({ folder, depth = 0, notes, allFolders, onRefresh }) {
  const { id: activeNoteId } = useParams()
  const navigate = useNavigate()
  const [open, setOpen] = useState(depth === 0)
  const { isOnline } = useStore()

  const children = allFolders.filter((f) => f.parent_id === folder.id)
  const folderNotes = notes.filter((n) => n.folder_id === folder.id)

  async function handleNewNote() {
    const newNote = { title: 'Untitled', content: {}, folder_id: folder.id }
    if (isOnline) {
      try {
        const { createNote: cn } = await import('../lib/supabase')
        const created = await cn(newNote)
        useStore.getState().addNote(created)
        navigate(`/note/${created.id}`)
        closeDrawerIfMobile()
      } catch (e) { toast.error(e.message) }
    } else {
      const tempId = crypto.randomUUID()
      const tempNote = { ...newNote, id: tempId, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      useStore.getState().addNote(tempNote)
      await enqueueOutbox({ table_name: 'notes', operation: 'insert', record_id: tempId, payload: tempNote })
      navigate(`/note/${tempId}`)
      closeDrawerIfMobile()
    }
  }

  async function handleNewFolder() {
    const name = prompt('Folder name:')
    if (!name) return
    try {
      await createFolder({ name, parent_id: folder.id, order: children.length })
      onRefresh()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div>
      <div
        className={`nav-item group`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => setOpen(!open)}
      >
        <span className="text-ink-faint w-4 shrink-0">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="flex-1 truncate text-xs font-semibold uppercase tracking-wider text-ink-faint">{folder.name}</span>
        <span className="flex md:hidden md:group-hover:flex gap-0.5">
          <button onClick={(e) => { e.stopPropagation(); handleNewNote() }} title="New note"
            className="p-1 rounded hover:bg-surface-3 text-ink-muted hover:text-ink">
            <FilePlus size={14} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); handleNewFolder() }} title="New folder"
            className="p-1 rounded hover:bg-surface-3 text-ink-muted hover:text-ink">
            <FolderPlus size={14} />
          </button>
        </span>
      </div>

      {open && (
        <>
          {children.map((child) => (
            <FolderNode key={child.id} folder={child} depth={depth + 1} notes={notes} allFolders={allFolders} onRefresh={onRefresh} />
          ))}
          {folderNotes.map((note) => (
            <NoteItem key={note.id} note={note} depth={depth + 1} active={note.id === activeNoteId} onRefresh={onRefresh} />
          ))}
          {folderNotes.length === 0 && children.length === 0 && (
            <div style={{ paddingLeft: `${28 + depth * 14}px` }}
              className="text-xs text-ink-faint py-1 italic">Empty</div>
          )}
        </>
      )}
    </div>
  )
}

function NoteItem({ note, depth, active, onRefresh }) {
  const navigate = useNavigate()
  const { setActiveNoteId } = useStore()

  function open() {
    setActiveNoteId(note.id)
    navigate(`/note/${note.id}`)
    closeDrawerIfMobile()
  }

  async function handleDelete(e) {
    e.stopPropagation()
    if (!confirm(`Delete "${note.title}"?`)) return
    try {
      await deleteNote(note.id)
      useStore.getState().removeNote(note.id)
      onRefresh()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div
      className={`nav-item group ${active ? 'active' : ''}`}
      style={{ paddingLeft: `${28 + depth * 14}px` }}
      onClick={open}
    >
      <span className="text-ink-faint shrink-0 text-xs">📄</span>
      <span className="flex-1 truncate text-sm">{note.title || 'Untitled'}</span>
      <button
        onClick={handleDelete}
        aria-label="Delete note"
        className="block md:hidden md:group-hover:block px-1.5 rounded hover:bg-surface-3 text-ink-faint hover:text-red-400"
      >×</button>
    </div>
  )
}

export default function Sidebar({ onRefresh }) {
  const { folders, notes, isOnline, outboxCount, toggleSidebar, setRightPanelMode, rightPanelMode, openIntake, openOrganize } = useStore()
  const navigate = useNavigate()

  const rootFolders = folders.filter((f) => f.parent_id === null)

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  async function handleNewRootFolder() {
    const name = prompt('New folder name:')
    if (!name || !name.trim()) return
    try {
      await createFolder({ name: name.trim(), parent_id: null, order: rootFolders.length })
      onRefresh()
    } catch (e) { toast.error(e.message) }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-surface-2">
        <button onClick={toggleSidebar} className="p-1 rounded hover:bg-surface-2 text-ink-muted hover:text-ink">
          <Menu size={16} />
        </button>
        <span className="font-bold text-white text-sm flex-1">IntraNotes</span>
        {!isOnline && <WifiOff size={14} className="text-yellow-500" title="Offline" />}
        {outboxCount > 0 && (
          <span className="text-xs bg-yellow-900 text-yellow-300 rounded-full px-1.5 py-0.5">{outboxCount}</span>
        )}
      </div>

      {/* Nav icons */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-surface-2">
        <button
          onClick={() => { openIntake(); closeDrawerIfMobile() }}
          title="Add from text or URL"
          className="p-2 rounded hover:bg-surface-2 transition-colors text-ink-muted hover:text-ink"
        ><Plus size={16} /></button>
        <span className="w-px h-5 bg-surface-2 mx-0.5" />
        <button
          onClick={() => { setRightPanelMode(null); navigate('/'); closeDrawerIfMobile() }}
          title="Graph (home)"
          className="p-2 rounded hover:bg-surface-2 transition-colors text-ink-muted hover:text-ink"
        ><GitBranch size={16} /></button>
        <button
          onClick={() => { setRightPanelMode('tags'); closeDrawerIfMobile() }}
          title="Tags"
          className={`p-2 rounded hover:bg-surface-2 transition-colors ${rightPanelMode === 'tags' ? 'text-accent' : 'text-ink-muted'}`}
        ><Tag size={16} /></button>
        <button
          onClick={() => { setRightPanelMode('backlinks'); closeDrawerIfMobile() }}
          title="Backlinks"
          className={`p-2 rounded hover:bg-surface-2 transition-colors ${rightPanelMode === 'backlinks' ? 'text-accent' : 'text-ink-muted'}`}
        ><LayoutDashboard size={16} /></button>
        <span className="w-px h-5 bg-surface-2 mx-0.5" />
        <button
          onClick={() => { openOrganize(); closeDrawerIfMobile() }}
          title="Organize vault (AI tag + link)"
          className="p-2 rounded hover:bg-surface-2 transition-colors text-ink-muted hover:text-accent"
        ><Wand2 size={16} /></button>
      </div>

      {/* Folder tree */}
      <div className="flex-1 overflow-y-auto py-1">
        <div className="flex items-center px-3 pt-1 pb-0.5 group">
          <span className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Folders</span>
          <button
            onClick={handleNewRootFolder}
            title="New top-level folder"
            className="p-1 rounded hover:bg-surface-2 text-ink-muted hover:text-ink"
          ><FolderPlus size={14} /></button>
        </div>
        {rootFolders.map((folder) => (
          <FolderNode
            key={folder.id}
            folder={folder}
            depth={0}
            notes={notes}
            allFolders={folders}
            onRefresh={onRefresh}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-surface-2 px-3 py-2">
        <button onClick={handleSignOut} className="nav-item w-full text-xs text-ink-faint hover:text-red-400">
          <LogOut size={13} />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  )
}
