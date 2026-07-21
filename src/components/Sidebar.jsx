import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ChevronRight, ChevronDown, FolderPlus,
  LayoutDashboard, Tag, GitBranch, LogOut, WifiOff,
  Menu, Plus, Wand2
} from 'lucide-react'
import { useStore } from '../lib/store'
import { createFolder, deleteNote, updateFolder, deleteFolder, updateNote } from '../lib/supabase'
import { enqueueOutbox } from '../lib/offline'
import { supabase } from '../lib/supabase'
import FolderActionsMenu from './FolderActionsMenu'
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
    if (!name || !name.trim()) return
    try {
      await createFolder({ name: name.trim(), parent_id: folder.id, order: children.length })
      onRefresh()
    } catch (e) { toast.error(e.message) }
  }

  async function handleRename() {
    const name = prompt('Rename folder:', folder.name)
    if (!name || !name.trim() || name.trim() === folder.name) return
    try {
      await updateFolder(folder.id, { name: name.trim() })
      onRefresh()
    } catch (e) { toast.error(e.message) }
  }

  async function handleMove(parentId) {
    try {
      await updateFolder(folder.id, { parent_id: parentId })
      onRefresh()
    } catch (e) { toast.error(e.message) }
  }

  // Delete the folder but keep its contents: move direct notes and subfolders
  // up to this folder's parent (or top level), then delete.
  async function handleDeleteFolder() {
    const subFolders = allFolders.filter((f) => f.parent_id === folder.id)
    const notesHere = notes.filter((n) => n.folder_id === folder.id)
    const parts = []
    if (notesHere.length) parts.push(`${notesHere.length} note${notesHere.length === 1 ? '' : 's'}`)
    if (subFolders.length) parts.push(`${subFolders.length} subfolder${subFolders.length === 1 ? '' : 's'}`)
    const where = folder.parent_id ? 'up a level' : 'to the top level'
    const msg = parts.length
      ? `Delete "${folder.name}"? Its ${parts.join(' and ')} will move ${where}.`
      : `Delete "${folder.name}"?`
    if (!confirm(msg)) return
    try {
      for (const c of subFolders) await updateFolder(c.id, { parent_id: folder.parent_id })
      for (const n of notesHere) await updateNote(n.id, { folder_id: folder.parent_id })
      await deleteFolder(folder.id)
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
        <span className="flex md:hidden md:group-hover:flex" onClick={(e) => e.stopPropagation()}>
          <FolderActionsMenu
            folder={folder}
            folders={allFolders}
            onNewNote={handleNewNote}
            onNewFolder={handleNewFolder}
            onRename={handleRename}
            onMove={handleMove}
            onDelete={handleDeleteFolder}
          />
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
  const { id: activeNoteId } = useParams()

  const rootFolders = folders.filter((f) => f.parent_id === null)
  const folderIdSet = new Set(folders.map((f) => f.id))
  const uncategorized = notes.filter((n) => !n.folder_id || !folderIdSet.has(n.folder_id))

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

        {uncategorized.length > 0 && (
          <div className="mt-2">
            <div className="px-3 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Uncategorized</div>
            {uncategorized.map((n) => (
              <NoteItem key={n.id} note={n} depth={1} active={n.id === activeNoteId} onRefresh={onRefresh} />
            ))}
          </div>
        )}
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
