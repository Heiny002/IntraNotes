import { useEffect, useRef, useCallback, useState, useMemo, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import { Mark } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code,
  List, ListOrdered, CheckSquare, Table as TableIcon, Image as ImageIcon,
  AlignLeft, AlignCenter, AlignRight, Loader2, Link as LinkIcon,
  Pen, Wand2, Tag, LayoutDashboard
} from 'lucide-react'
import { useStore } from '../lib/store'
import { fetchNote, updateNote, syncLinks, uploadMedia, createNote } from '../lib/supabase'
import { cacheNote, enqueueOutbox } from '../lib/offline'
import { generateEmbedding, summarizeUrl, extractWikiLinks } from '../lib/ai'
import { organizeSingleNote } from '../lib/librarian'
import { rankNotes } from '../lib/fuzzy'
import WikiLinkMenu from './WikiLinkMenu'
import FolderPicker from './FolderPicker'
import toast from 'react-hot-toast'

// Excalidraw is heavy (~2 MB) — only load it when the drawing pad opens.
const DrawingPad = lazy(() => import('./DrawingPad'))

const lowlight = createLowlight(common)

// WikiLink mark — renders [[Title]] as styled spans
const WikiLinkMark = Mark.create({
  name: 'wikiLink',
  addAttributes() {
    return { title: { default: null }, noteId: { default: null } }
  },
  parseHTML() {
    return [{ tag: 'span[data-wiki-link]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-wiki-link': '', class: 'wiki-link', ...HTMLAttributes }, 0]
  },
})

// Scan the doc for [[Title]] spans and decorate them as clickable wiki-links.
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g

function buildWikiLinkDecorations(doc) {
  const decorations = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    WIKILINK_RE.lastIndex = 0
    let match
    while ((match = WIKILINK_RE.exec(node.text)) !== null) {
      const start = pos + match.index
      const end = start + match[0].length
      decorations.push(
        Decoration.inline(start, end, {
          class: 'wiki-link',
          'data-wiki-title': match[1].trim(),
        })
      )
    }
  })
  return DecorationSet.create(doc, decorations)
}

// Styles [[...]] inline and routes clicks to the linked note.
const WikiLinkExtension = Extension.create({
  name: 'wikiLinkDecoration',
  addOptions() {
    return { onClickLink: () => {} }
  },
  addProseMirrorPlugins() {
    const { onClickLink } = this.options
    return [
      new Plugin({
        key: new PluginKey('wikiLinkDecoration'),
        state: {
          init: (_, { doc }) => buildWikiLinkDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildWikiLinkDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return this.getState(state)
          },
          handleClick(_view, _pos, event) {
            const el = event.target?.closest?.('[data-wiki-title]')
            const title = el?.getAttribute('data-wiki-title')
            if (title) {
              onClickLink(title, { x: event.clientX, y: event.clientY })
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})

const AUTOSAVE_DELAY = 1500

export default function NoteEditor({ onLinksChange }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { isOnline, setActiveNoteId, setRightPanelMode, rightPanelMode } = useStore()
  const allNotes = useStore((s) => s.notes)
  const folders = useStore((s) => s.folders)

  const [note, setNote] = useState(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [showDrawing, setShowDrawing] = useState(false)

  // [[wiki-link]] autocomplete / chooser menu.
  // mode 'type' = live while typing (has from/to text range); 'click' = chooser
  // opened by clicking an unresolved link.
  const [menu, setMenu] = useState(null)
  const [menuIdx, setMenuIdx] = useState(0)

  const saveTimer = useRef(null)
  const titleRef = useRef(null)
  const menuStateRef = useRef({ active: false, items: [] })
  const menuElRef = useRef(null)
  const allNotesRef = useRef(allNotes)
  allNotesRef.current = allNotes

  // Ranked items for the [[ menu: fuzzy note matches + an explicit create option.
  const menuItems = useMemo(() => {
    if (!menu) return []
    const q = (menu.query || '').trim()
    const ranked = rankNotes(q, allNotes.filter((n) => n.id !== id), 6)
      .map((x) => ({ type: 'note', key: x.note.id, id: x.note.id, title: x.note.title, score: x.score }))
    const exact = allNotes.some((n) => (n.title || '').trim().toLowerCase() === q.toLowerCase())
    if (q && !exact) ranked.push({ type: 'create', key: '__create__', title: q })
    return ranked
  }, [menu, allNotes, id])

  // Reset highlight when the query/menu changes.
  useEffect(() => { setMenuIdx(0) }, [menu?.query, menu?.mode])

  // Latest snapshot for the editor keydown handler (which is captured once at
  // editor creation). Written during render; only ever read in event handlers,
  // never during render, so this is safe.
  menuStateRef.current = {
    active: !!menu && menuItems.length > 0,
    menu,
    items: menuItems,
    idx: menuIdx,
    setIdx: setMenuIdx,
    select: selectMenuItem,
    close: () => setMenu(null),
  }

  // Dismiss the menu on an outside click or Escape.
  useEffect(() => {
    if (!menu) return
    function onDown(e) {
      if (menuElRef.current && !menuElRef.current.contains(e.target)) setMenu(null)
    }
    function onKey(e) { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  // Detect an open `[[query` before the caret and position the menu there.
  function syncTypeMenu(ed) {
    const sel = ed.state.selection
    if (!sel.empty) { setMenu((cur) => (cur?.mode === 'type' ? null : cur)); return }
    const $from = sel.$from
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼')
    const match = /\[\[([^[\]\n]*)$/.exec(before)
    if (!match) { setMenu((cur) => (cur?.mode === 'type' ? null : cur)); return }
    const query = match[1]
    const to = sel.from
    const from = to - (query.length + 2)
    let coords
    try { coords = ed.view.coordsAtPos(to) } catch { return }
    setMenu({ mode: 'type', query, from, to, x: coords.left, y: coords.bottom + 4 })
  }

  // Click a [[wiki-link]]: resolve to a note, or (if none) open the chooser so
  // the user can pick a fuzzy match or explicitly create — never auto-create.
  function handleWikiLinkClick(title, coords) {
    const existing = allNotesRef.current.find(
      (n) => (n.title || '').trim().toLowerCase() === title.trim().toLowerCase()
    )
    if (existing) {
      navigate(`/note/${existing.id}`)
      return
    }
    setMenu({ mode: 'click', query: title, from: null, to: null, x: coords?.x ?? 240, y: (coords?.y ?? 200) + 10 })
    setMenuIdx(0)
  }

  // Create a note on the fly in the current note's folder.
  async function createOnFly(rawTitle) {
    const t = (rawTitle || '').trim()
    if (!t) return null
    const state = useStore.getState()
    const current = state.notes.find((n) => n.id === state.activeNoteId)
    const folder_id = current?.folder_id ?? '00000000-0000-0000-0000-000000000001'
    try {
      const created = await createNote({ title: t, content: {}, folder_id })
      state.addNote(created)
      return created
    } catch (e) {
      toast.error(e.message)
      return null
    }
  }

  // Selecting an item from the [[ menu.
  async function selectMenuItem(item) {
    const m = menuStateRef.current.menu
    if (!m || !item) return
    if (m.mode === 'type') {
      let linkTitle = item.title
      if (item.type === 'create') {
        const created = await createOnFly(item.title)
        if (!created) { setMenu(null); return }
        linkTitle = created.title
      }
      editor?.chain().focus().insertContentAt({ from: m.from, to: m.to }, `[[${linkTitle}]]`).run()
    } else {
      // click mode — navigate (creating first if needed)
      if (item.type === 'create') {
        const created = await createOnFly(item.title)
        if (created) navigate(`/note/${created.id}`)
      } else {
        navigate(`/note/${item.id}`)
      }
    }
    setMenu(null)
  }

  useEffect(() => {
    setActiveNoteId(id)
    loadNote()
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadNote() {
    try {
      let n
      if (isOnline) {
        n = await fetchNote(id)
      } else {
        const { getCachedNote } = await import('../lib/offline')
        n = await getCachedNote(id)
      }
      if (!n) { toast.error('Note not found'); navigate('/'); return }
      setNote(n)
      setTitle(n.title)
    } catch (e) {
      toast.error('Failed to load note')
    }
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Placeholder.configure({ placeholder: 'Start writing… (use [[Note Title]] to link notes)' }),
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: true }),
      TableRow, TableHeader, TableCell,
      TaskList, TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      CodeBlockLowlight.configure({ lowlight }),
      WikiLinkMark,
      WikiLinkExtension.configure({ onClickLink: handleWikiLinkClick }),
    ],
    content: '',
    editorProps: {
      attributes: { class: 'tiptap px-4 md:px-8 py-6 max-w-3xl mx-auto' },
      handleKeyDown: (_view, event) => {
        const st = menuStateRef.current
        if (!st.active || !st.items.length) return false
        if (event.key === 'ArrowDown') { st.setIdx((st.idx + 1) % st.items.length); return true }
        if (event.key === 'ArrowUp') { st.setIdx((st.idx - 1 + st.items.length) % st.items.length); return true }
        if (event.key === 'Enter' || event.key === 'Tab') { st.select(st.items[st.idx]); return true }
        if (event.key === 'Escape') { st.close(); return true }
        return false
      },
    },
    onUpdate: ({ editor }) => {
      scheduleSave(editor.getJSON())
      syncTypeMenu(editor)
    },
    onSelectionUpdate: ({ editor }) => {
      syncTypeMenu(editor)
    },
  })

  // Sync content when the note changes. Always reset the editor — including
  // clearing it for notes with empty content — so a new note never shows the
  // previously-open note's body.
  useEffect(() => {
    if (!editor) return
    const c = note?.content
    const hasContent = c && typeof c === 'object' && Object.keys(c).length > 0
    editor.commands.setContent(hasContent ? c : '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, note?.id])

  function scheduleSave(content) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => doSave(content), AUTOSAVE_DELAY)
  }

  const doSave = useCallback(async (content) => {
    if (!id || !editor) return
    setSaving(true)
    const text = editor.getText()
    const wordCount = text.split(/\s+/).filter(Boolean).length
    const patch = { title, content, content_text: text, word_count: wordCount, updated_at: new Date().toISOString() }

    try {
      if (isOnline) {
        await updateNote(id, patch)
        // Fire-and-forget embedding generation
        generateEmbedding(id, `${title} ${text}`).catch(() => {})
        // Sync wiki links
        const linkedTitles = extractWikiLinks(content)
        if (linkedTitles.length > 0) {
          const allNotes = useStore.getState().notes
          const targetIds = linkedTitles
            .map((t) => allNotes.find((n) => (n.title || '').trim().toLowerCase() === t.trim().toLowerCase())?.id)
            .filter(Boolean)
          await syncLinks(id, targetIds)
          if (onLinksChange) onLinksChange()
        }
      } else {
        await enqueueOutbox({ table_name: 'notes', operation: 'update', record_id: id, payload: patch })
      }
      await cacheNote({ ...note, ...patch })
      useStore.getState().updateNoteInList(id, { title, word_count: wordCount, updated_at: patch.updated_at })
    } catch (e) {
      console.error('Save error', e)
    } finally {
      setSaving(false)
    }
  }, [id, title, editor, isOnline, note, onLinksChange])

  // Title save on blur
  function onTitleBlur() {
    if (editor) doSave(editor.getJSON())
  }

  // Move this note to another folder.
  async function moveToFolder(folderId) {
    if (!note || folderId === note.folder_id) return
    try {
      await updateNote(id, { folder_id: folderId })
      setNote((n) => (n ? { ...n, folder_id: folderId } : n))
      useStore.getState().updateNoteInList(id, { folder_id: folderId })
      const dest = useStore.getState().folders.find((f) => f.id === folderId)
      toast.success(`Moved to ${dest?.name || 'folder'}`)
    } catch (e) {
      toast.error(e.message)
    }
  }

  // AI librarian: tag this note + link unlinked mentions of other notes.
  async function handleOrganize() {
    if (!editor) return
    setAiLoading(true)
    try {
      await doSave(editor.getJSON()) // work on the latest content
      const r = await organizeSingleNote(id, { tags: true, links: true })
      const fresh = await fetchNote(id)
      setNote(fresh)
      if (fresh?.content && Object.keys(fresh.content).length > 0) {
        editor.commands.setContent(fresh.content, false)
      }
      if (onLinksChange) onLinksChange()
      toast.success(`Organized · +${r.tagsAdded} tag${r.tagsAdded === 1 ? '' : 's'} · +${r.linksAdded} link${r.linksAdded === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error('Organize failed: ' + e.message)
    } finally {
      setAiLoading(false)
    }
  }

  // AI: suggest links

  // AI: summarize URL
  async function handleSummarizeUrl(e) {
    e.preventDefault()
    if (!urlInput) return
    setAiLoading(true)
    setShowUrlModal(false)
    try {
      const result = await summarizeUrl(urlInput)
      if (result.tiptap_content) {
        editor.commands.setContent(result.tiptap_content)
        setTitle(result.title)
      }
      if (result.tags?.length) toast.success(`Tags suggested: ${result.tags.join(', ')}`)
    } catch (e) {
      toast.error('URL summarize failed: ' + e.message)
    } finally {
      setAiLoading(false)
      setUrlInput('')
    }
  }

  // Image upload
  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !id) return
    try {
      const media = await uploadMedia(id, file)
      editor.chain().focus().setImage({ src: media.public_url, alt: file.name }).run()
      toast.success('Image uploaded')
    } catch (e) {
      toast.error('Upload failed: ' + e.message)
    }
  }

  if (!note) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-accent" size={24} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 md:px-4 py-2 border-b border-surface-2 bg-surface-0 overflow-x-auto shrink-0">
        <ToolBtn onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive('bold')} title="Bold"><Bold size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')} title="Italic"><Italic size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive('underline')} title="Underline"><UnderlineIcon size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().toggleStrike().run()} active={editor?.isActive('strike')} title="Strikethrough"><Strikethrough size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().toggleCode().run()} active={editor?.isActive('code')} title="Inline code"><Code size={14}/></ToolBtn>
        <Sep />
        <ToolBtn onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} title="Bullet list"><List size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} title="Ordered list"><ListOrdered size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().toggleTaskList().run()} active={editor?.isActive('taskList')} title="Task list"><CheckSquare size={14}/></ToolBtn>
        <Sep />
        <ToolBtn onClick={() => editor?.chain().focus().setTextAlign('left').run()} active={editor?.isActive({ textAlign: 'left' })} title="Align left"><AlignLeft size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().setTextAlign('center').run()} active={editor?.isActive({ textAlign: 'center' })} title="Align center"><AlignCenter size={14}/></ToolBtn>
        <ToolBtn onClick={() => editor?.chain().focus().setTextAlign('right').run()} active={editor?.isActive({ textAlign: 'right' })} title="Align right"><AlignRight size={14}/></ToolBtn>
        <Sep />
        <ToolBtn
          onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          title="Insert table"
        ><TableIcon size={14}/></ToolBtn>
        <label className="cursor-pointer" title="Upload image">
          <ToolBtn as="span"><ImageIcon size={14}/></ToolBtn>
          <input type="file" accept="image/*,video/*" className="hidden" onChange={handleImageUpload} />
        </label>
        <ToolBtn onClick={() => setShowDrawing(true)} title="Drawing pad"><Pen size={14}/></ToolBtn>
        <ToolBtn onClick={() => setShowUrlModal(true)} title="Summarize URL"><LinkIcon size={14}/></ToolBtn>
        <Sep />
        <ToolBtn onClick={handleOrganize} disabled={aiLoading} title="AI: tag & link this note">
          {aiLoading ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14}/>}
        </ToolBtn>

        <div className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
          {saving && <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin"/>Saving</span>}
          {!saving && <span className="text-green-500/70">Saved</span>}
        </div>
      </div>

      {/* Title — a distinct, contrasting field so it reads clearly as the title
          (not body text), capped at 100 characters. Stays pinned above the
          scrolling body. */}
      <div className="shrink-0 px-4 md:px-8 pt-4 md:pt-6 pb-2 max-w-3xl mx-auto w-full">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Title</label>
          <div className="flex items-center gap-1">
            <FolderPicker folders={folders} value={note?.folder_id ?? null} onChange={moveToFolder} />
            <button
              type="button"
              onClick={() => setRightPanelMode('tags')}
              title="Tags"
              className={`p-1.5 rounded hover:bg-surface-2 transition-colors ${rightPanelMode === 'tags' ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
            ><Tag size={15} /></button>
            <button
              type="button"
              onClick={() => setRightPanelMode('backlinks')}
              title="Backlinks"
              className={`p-1.5 rounded hover:bg-surface-2 transition-colors ${rightPanelMode === 'backlinks' ? 'text-accent' : 'text-ink-muted hover:text-ink'}`}
            ><LayoutDashboard size={15} /></button>
          </div>
        </div>
        <input
          ref={titleRef}
          type="text"
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={onTitleBlur}
          onKeyDown={(e) => {
            // The title is a single-line field — send Enter/Down into the body.
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault()
              editor?.commands.focus('start')
            }
          }}
          placeholder="Note title…"
          className="w-full text-2xl md:text-3xl font-bold text-white bg-surface-2/50 border border-surface-3 rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-accent focus:border-accent placeholder-ink-faint transition-colors"
        />
      </div>
      <div className="shrink-0 px-4 md:px-8 max-w-3xl mx-auto w-full">
        <div className="border-b border-surface-2" />
      </div>

      {/* Editor — the only scrolling region; min-h-0 lets it scroll inside the
          flex column instead of pushing the header off-screen. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      {/* [[wiki-link]] autocomplete / chooser */}
      {menu && menuItems.length > 0 && (
        <WikiLinkMenu
          menuRef={menuElRef}
          x={menu.x}
          y={menu.y}
          items={menuItems}
          activeIndex={menuIdx}
          onHover={setMenuIdx}
          onSelect={selectMenuItem}
        />
      )}

      {/* URL Summarize Modal */}
      {showUrlModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowUrlModal(false)}>
          <form
            className="bg-surface-1 border border-surface-2 rounded-xl p-6 w-full max-w-md shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSummarizeUrl}
          >
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2"><LinkIcon size={16} className="text-accent"/> Summarize URL</h3>
            <input
              autoFocus
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/article"
              className="w-full bg-surface-2 border border-surface-3 rounded-lg px-3 py-2 text-ink text-sm outline-none focus:ring-2 focus:ring-accent mb-4"
              required
            />
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowUrlModal(false)} className="px-4 py-2 text-sm text-ink-muted hover:text-ink">Cancel</button>
              <button type="submit" className="px-4 py-2 bg-accent hover:bg-accent-hover text-white rounded-lg text-sm font-medium">Summarize</button>
            </div>
          </form>
        </div>
      )}

      {/* Drawing Pad Modal */}
      {showDrawing && (
        <Suspense fallback={
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
            <Loader2 className="animate-spin text-accent" size={28} />
          </div>
        }>
          <DrawingPad
            noteId={id}
            onClose={() => setShowDrawing(false)}
            onSave={(dataUrl) => {
              editor?.chain().focus().setImage({ src: dataUrl, alt: 'Drawing' }).run()
              setShowDrawing(false)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

function ToolBtn({ children, onClick, active, disabled, title, as: Tag = 'button' }) {
  const cls = [
    'p-1.5 rounded transition-colors',
    active ? 'bg-surface-3 text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-2',
    disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
  ].join(' ')
  if (Tag === 'span') return <span className={cls} title={title}>{children}</span>
  return <button type="button" onClick={onClick} disabled={disabled} title={title} className={cls}>{children}</button>
}

function Sep() {
  return <div className="w-px h-5 bg-surface-3 mx-1 shrink-0" />
}
