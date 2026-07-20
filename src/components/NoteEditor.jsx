import { useEffect, useRef, useCallback, useState, lazy, Suspense } from 'react'
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
  AlignLeft, AlignCenter, AlignRight, Sparkles, Loader2, Link as LinkIcon,
  Pen
} from 'lucide-react'
import { useStore } from '../lib/store'
import { fetchNote, updateNote, syncLinks, uploadMedia, createNote } from '../lib/supabase'
import { cacheNote, enqueueOutbox } from '../lib/offline'
import { generateEmbedding, suggestLinks, summarizeUrl, extractWikiLinks } from '../lib/ai'
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
              onClickLink(title)
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
  const { isOnline, setActiveNoteId } = useStore()

  const [note, setNote] = useState(null)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showUrlModal, setShowUrlModal] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [showDrawing, setShowDrawing] = useState(false)

  const saveTimer = useRef(null)
  const titleRef = useRef(null)

  // Navigate to a [[wiki-linked]] note, creating it if it doesn't exist yet.
  async function handleWikiLinkClick(title) {
    const state = useStore.getState()
    const existing = state.notes.find(
      (n) => (n.title || '').trim().toLowerCase() === title.trim().toLowerCase()
    )
    if (existing) {
      navigate(`/note/${existing.id}`)
      return
    }
    const current = state.notes.find((n) => n.id === state.activeNoteId)
    const folder_id = current?.folder_id ?? '00000000-0000-0000-0000-000000000001'
    try {
      const created = await createNote({ title: title.trim(), content: {}, folder_id })
      state.addNote(created)
      toast.success(`Created "${title.trim()}"`)
      navigate(`/note/${created.id}`)
    } catch (e) {
      toast.error(e.message)
    }
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
    },
    onUpdate: ({ editor }) => {
      scheduleSave(editor.getJSON())
    },
  })

  // Sync content when note loads
  useEffect(() => {
    if (editor && note?.content && Object.keys(note.content).length > 0) {
      editor.commands.setContent(note.content, false)
    }
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
          const targetIds = linkedTitles.map((t) => allNotes.find((n) => n.title === t)?.id).filter(Boolean)
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

  // AI: suggest links
  async function handleSuggestLinks() {
    if (!editor) return
    setAiLoading(true)
    setSuggestions([])
    try {
      const text = `${title}\n${editor.getText()}`
      const results = await suggestLinks(id, text)
      setSuggestions(results)
      setShowSuggestions(true)
    } catch (e) {
      toast.error('AI suggest failed: ' + e.message)
    } finally {
      setAiLoading(false)
    }
  }

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
        <ToolBtn onClick={handleSuggestLinks} disabled={aiLoading} title="AI: suggest links">
          {aiLoading ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}
        </ToolBtn>

        <div className="ml-auto flex items-center gap-2 text-xs text-ink-faint">
          {saving && <span className="flex items-center gap-1"><Loader2 size={11} className="animate-spin"/>Saving</span>}
          {!saving && <span className="text-green-500/70">Saved</span>}
        </div>
      </div>

      {/* Title */}
      <div className="px-4 md:px-8 pt-5 md:pt-8 pb-2 max-w-3xl mx-auto w-full">
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={onTitleBlur}
          onKeyDown={(e) => {
            // The title is a single-line field — send Enter/Down into the body.
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault()
              editor?.commands.focus('start')
            }
          }}
          placeholder="Untitled"
          className="w-full text-3xl md:text-4xl font-bold bg-transparent text-white outline-none placeholder-surface-3"
        />
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      {/* AI Suggestions Panel */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="border-t border-surface-2 bg-surface-0 px-6 py-4 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              <Sparkles size={14} className="text-accent"/> AI Link Suggestions
            </h4>
            <button onClick={() => setShowSuggestions(false)} className="text-ink-faint hover:text-ink text-lg">×</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => { navigate(`/note/${s.id}`); setShowSuggestions(false) }}
                className="flex items-start gap-2 bg-surface-2 hover:bg-surface-3 border border-surface-3 rounded-lg px-3 py-2 text-left max-w-xs transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-white">{s.title}</div>
                  {s.reason && <div className="text-xs text-ink-muted mt-0.5">{s.reason}</div>}
                  <div className="text-xs text-accent mt-1">{Math.round((s.vec_score ?? 0) * 100)}% similar</div>
                </div>
              </button>
            ))}
          </div>
        </div>
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
