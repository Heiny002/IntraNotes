import { useEffect, useCallback } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useStore } from '../lib/store'
import { fetchFolders, fetchNotes, fetchTags } from '../lib/supabase'
import { cacheFolders, cacheNote, getCachedFolders, getCachedNotes, getOutboxCount } from '../lib/offline'
import Sidebar from '../components/Sidebar'
import NoteEditor from '../components/NoteEditor'
import SearchModal from '../components/SearchModal'
import BacklinksPanel from '../components/BacklinksPanel'
import TagBrowser from '../components/TagBrowser'
import GraphView from '../components/GraphView'
import WelcomeScreen from '../components/WelcomeScreen'

export default function MainLayout() {
  const {
    setFolders, setNotes, setTags,
    sidebarOpen, rightPanelMode,
    activeNoteId, searchOpen, isOnline,
    setOutboxCount,
  } = useStore()

  const loadData = useCallback(async () => {
    try {
      if (isOnline) {
        const [folders, notes, tags] = await Promise.all([
          fetchFolders(), fetchNotes(), fetchTags()
        ])
        setFolders(folders)
        setNotes(notes)
        setTags(tags)
        await cacheFolders(folders)
        notes.forEach(cacheNote)
      } else {
        const [folders, notes] = await Promise.all([getCachedFolders(), getCachedNotes()])
        setFolders(folders)
        setNotes(notes)
      }
    } catch (err) {
      console.error('Failed to load data', err)
    }
    const count = await getOutboxCount()
    setOutboxCount(count)
  }, [isOnline, setFolders, setNotes, setTags, setOutboxCount])

  useEffect(() => { loadData() }, [loadData])

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        useStore.getState().setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="h-screen flex bg-surface-1 overflow-hidden">
      {/* Sidebar */}
      {sidebarOpen && (
        <aside className="w-60 shrink-0 border-r border-surface-2 flex flex-col bg-surface-0">
          <Sidebar onRefresh={loadData} />
        </aside>
      )}

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Routes>
          <Route path="/" element={<WelcomeScreen />} />
          <Route path="/note/:id" element={<NoteEditor onLinksChange={loadData} />} />
        </Routes>
      </main>

      {/* Right panel */}
      {rightPanelMode && activeNoteId && (
        <aside className="w-72 shrink-0 panel">
          {rightPanelMode === 'backlinks' && <BacklinksPanel noteId={activeNoteId} />}
          {rightPanelMode === 'tags'      && <TagBrowser noteId={activeNoteId} />}
          {rightPanelMode === 'graph'     && <GraphView />}
        </aside>
      )}

      {/* Search modal */}
      {searchOpen && <SearchModal />}
    </div>
  )
}
