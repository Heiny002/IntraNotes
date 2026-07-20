import { useEffect, useCallback } from 'react'
import { Routes, Route, useNavigate, useSearchParams } from 'react-router-dom'
import { Menu, Search, Plus } from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'
import { useStore } from '../lib/store'
import { fetchFolders, fetchNotes, fetchTags } from '../lib/supabase'
import { isUrl } from '../lib/intake'
import { cacheFolders, cacheNote, getCachedFolders, getCachedNotes, getOutboxCount } from '../lib/offline'
import { useRealtimeSync } from '../hooks/useRealtimeSync'
import { useOfflineSync } from '../hooks/useOfflineSync'
import Sidebar from '../components/Sidebar'
import NoteEditor from '../components/NoteEditor'
import SearchModal from '../components/SearchModal'
import IntakeModal from '../components/IntakeModal'
import BacklinksPanel from '../components/BacklinksPanel'
import TagBrowser from '../components/TagBrowser'
import GraphView from '../components/GraphView'
import WelcomeScreen from '../components/WelcomeScreen'

// PWA share-target landing: /share?url=&text=&title= opens the intake prefilled.
function ShareHandler() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const openIntake = useStore((s) => s.openIntake)
  useEffect(() => {
    const url = (params.get('url') || '').trim()
    const text = (params.get('text') || '').trim()
    const shared = url || text
    if (shared) {
      const asUrl = isUrl(url) || isUrl(text)
      openIntake({ mode: asUrl ? 'url' : 'text', value: asUrl ? (isUrl(url) ? url : text) : text })
    }
    navigate('/', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

export default function MainLayout() {
  const {
    setFolders, setNotes, setTags,
    sidebarOpen, toggleSidebar, setSidebarOpen, rightPanelMode, setRightPanelMode,
    activeNoteId, searchOpen, setSearchOpen, isOnline,
    setOutboxCount, intakeOpen, openIntake,
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

  // Live sync: realtime note changes + flush offline outbox when back online
  useRealtimeSync()
  useOfflineSync()

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

  // If there's a large chunk of text on the clipboard, offer to make a note from
  // it — but only when clipboard-read permission is already granted, so we never
  // trigger a surprise permission prompt on load.
  useEffect(() => {
    let cancelled = false
    async function maybeSuggest() {
      try {
        if (!navigator.clipboard?.readText || !navigator.permissions?.query) return
        const perm = await navigator.permissions.query({ name: 'clipboard-read' }).catch(() => null)
        if (!perm || perm.state !== 'granted') return
        const clip = (await navigator.clipboard.readText()).trim()
        if (cancelled || clip.length < 400) return
        toast((t) => (
          <span className="flex items-center gap-3">
            <span className="text-sm">Make a note from your clipboard?</span>
            <button
              onClick={() => { toast.dismiss(t.id); openIntake(isUrl(clip) ? { mode: 'url', value: clip } : { mode: 'text', value: clip }) }}
              className="text-sm font-medium text-accent hover:underline"
            >Create</button>
            <button onClick={() => toast.dismiss(t.id)} className="text-sm text-ink-faint hover:text-ink">Dismiss</button>
          </span>
        ), { duration: 8000 })
      } catch { /* ignore */ }
    }
    maybeSuggest()
    return () => { cancelled = true }
  }, [openIntake])

  return (
    <div className="h-[100dvh] flex bg-surface-1 overflow-hidden">
      {/* Backdrop for the mobile sidebar drawer */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — off-canvas drawer on mobile, collapsible column on desktop */}
      <aside
        className={clsx(
          'z-40 shrink-0 flex flex-col bg-surface-0 border-surface-2',
          'fixed inset-y-0 left-0 w-64 max-w-[85vw] border-r transition-transform duration-200 ease-out',
          'md:static md:transition-[width] md:duration-200',
          sidebarOpen
            ? 'translate-x-0 md:w-60'
            : '-translate-x-full md:translate-x-0 md:w-0 md:overflow-hidden md:border-r-0'
        )}
      >
        <Sidebar onRefresh={loadData} />
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar: always on mobile; on desktop only when the sidebar is collapsed */}
        <header
          className={clsx(
            'flex items-center gap-1 h-12 px-2 shrink-0 border-b border-surface-2 bg-surface-0',
            sidebarOpen && 'md:hidden'
          )}
        >
          <button
            onClick={toggleSidebar}
            aria-label="Toggle menu"
            className="p-2 rounded hover:bg-surface-2 text-ink-muted hover:text-ink"
          >
            <Menu size={18} />
          </button>
          <span className="flex-1 truncate font-bold text-white text-sm">IntraNotes</span>
          <button
            onClick={() => openIntake()}
            aria-label="Add note from text or URL"
            className="p-2 rounded hover:bg-surface-2 text-ink-muted hover:text-ink"
          >
            <Plus size={18} />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search"
            className="p-2 rounded hover:bg-surface-2 text-ink-muted hover:text-ink"
          >
            <Search size={18} />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
          <Routes>
            <Route path="/" element={<WelcomeScreen />} />
            <Route path="/note/:id" element={<NoteEditor onLinksChange={loadData} />} />
            <Route path="/share" element={<ShareHandler />} />
          </Routes>
        </div>
      </main>

      {/* Right panel — full-height overlay on mobile, side column on desktop */}
      {rightPanelMode && activeNoteId && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setRightPanelMode(null)}
            aria-hidden="true"
          />
          <aside className="panel z-40 fixed inset-y-0 right-0 w-80 max-w-[85vw] md:static md:z-auto md:w-72 md:shrink-0">
            {rightPanelMode === 'backlinks' && <BacklinksPanel noteId={activeNoteId} />}
            {rightPanelMode === 'tags'      && <TagBrowser noteId={activeNoteId} />}
            {rightPanelMode === 'graph'     && <GraphView />}
          </aside>
        </>
      )}

      {/* Search modal */}
      {searchOpen && <SearchModal />}

      {/* Intake modal (paste text / add URL) */}
      {intakeOpen && <IntakeModal />}
    </div>
  )
}
