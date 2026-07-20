/**
 * Global Zustand store — single source of truth for UI state
 */
import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export const useStore = create(
  subscribeWithSelector((set, get) => ({
    // ── Auth ──────────────────────────────────────────────────────────────
    session: null,
    authReady: false, // flips true once the first getSession() resolves
    setSession: (session) => set({ session, authReady: true }),

    // ── Folders ───────────────────────────────────────────────────────────
    folders: [],
    setFolders: (folders) => set({ folders }),
    activeFolderId: null,
    setActiveFolderId: (id) => set({ activeFolderId: id }),

    // ── Notes ─────────────────────────────────────────────────────────────
    notes: [],
    setNotes: (notes) => set({ notes }),
    activeNoteId: null,
    setActiveNoteId: (id) => set({ activeNoteId: id }),

    noteById: (id) => get().notes.find((n) => n.id === id),

    addNote: (note) => set((s) => ({ notes: [note, ...s.notes] })),

    updateNoteInList: (id, patch) =>
      set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),

    removeNote: (id) =>
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== id),
        activeNoteId: s.activeNoteId === id ? null : s.activeNoteId,
      })),

    // ── Tags ──────────────────────────────────────────────────────────────
    tags: [],
    setTags: (tags) => set({ tags }),

    // ── UI state ──────────────────────────────────────────────────────────
    // Start open on desktop, closed on mobile (drawer).
    sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 768 : true,
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
    setSidebarOpen: (v) => set({ sidebarOpen: v }),

    rightPanelMode: null, // null | 'backlinks' | 'tags' | 'graph' | 'drawing'
    setRightPanelMode: (mode) =>
      set((s) => ({ rightPanelMode: s.rightPanelMode === mode ? null : mode })),

    searchOpen: false,
    setSearchOpen: (v) => set({ searchOpen: v }),

    // Intake modal (paste text / add URL → Uploads folder)
    intakeOpen: false,
    intakePrefill: null, // { mode: 'text' | 'url', value: string } | null
    openIntake: (prefill = null) => set({ intakeOpen: true, intakePrefill: prefill }),
    closeIntake: () => set({ intakeOpen: false, intakePrefill: null }),

    // Organize-vault (AI librarian) modal
    organizeOpen: false,
    openOrganize: () => set({ organizeOpen: true }),
    closeOrganize: () => set({ organizeOpen: false }),

    // ── Offline ───────────────────────────────────────────────────────────
    isOnline: navigator.onLine,
    setIsOnline: (v) => set({ isOnline: v }),
    outboxCount: 0,
    setOutboxCount: (n) => set({ outboxCount: n }),
  }))
)
