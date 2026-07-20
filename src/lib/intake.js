/**
 * Intake: turn pasted text or a shared URL into a note filed under "Uploads".
 * URL scraping/summarizing/tagging is delegated to the `summarize-url` Edge
 * Function; if it isn't deployed yet, we still save the URL so nothing is lost.
 */
import {
  createFolder, createNote,
  createTag, fetchTags, setNoteTags,
} from './supabase'
import { summarizeUrl } from './ai'
import { useStore } from './store'

const UPLOADS = 'Uploads'

export function isUrl(str) {
  return /^https?:\/\/\S+$/i.test(String(str || '').trim())
}

/**
 * Find (or create) the top-level "Uploads" folder and return its id.
 * Reads from the store (kept fresh by MainLayout's loadData) instead of
 * re-fetching, then creates the folder only if it's genuinely missing.
 */
export async function getOrCreateUploadsFolder() {
  const state = useStore.getState()
  const existing = state.folders.find((f) => f.name === UPLOADS && !f.parent_id)
  if (existing) return existing.id

  const created = await createFolder({ name: UPLOADS, parent_id: null, order: state.folders.length })
  useStore.getState().setFolders([...useStore.getState().folders, created])
  return created.id
}

/** Convert plain text into a TipTap doc (one paragraph per line). */
export function textToDoc(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const paragraphs = lines.map((line) =>
    line.trim().length
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' }
  )
  return { type: 'doc', content: paragraphs.length ? paragraphs : [{ type: 'paragraph' }] }
}

/** Create a note from pasted text, filed under Uploads. Returns the note. */
export async function createNoteFromText(rawText) {
  const text = String(rawText || '').trim()
  if (!text) throw new Error('Nothing to save')
  const folder_id = await getOrCreateUploadsFolder()
  const firstLine = text.split('\n').find((l) => l.trim()) || 'Pasted note'
  const title = firstLine.trim().slice(0, 80)
  const note = await createNote({
    title,
    content: textToDoc(text),
    content_text: text,
    folder_id,
  })
  useStore.getState().addNote(note)
  return note
}

/** Apply AI-suggested tags to a note, reusing existing tags where possible. */
async function applyTags(noteId, names) {
  const clean = [...new Set(names.map((t) => String(t).toLowerCase().trim()).filter(Boolean))]
  if (!clean.length) return
  const existing = await fetchTags()
  const ids = []
  for (const name of clean) {
    let tag = existing.find((t) => t.name.toLowerCase() === name)
    if (!tag) {
      tag = await createTag({ name, color: '#6366f1' })
      existing.push(tag)
    }
    ids.push(tag.id)
  }
  useStore.getState().setTags(existing)
  if (ids.length) await setNoteTags(noteId, ids)
}

/**
 * Create a note from a URL, filed under Uploads. Tries to scrape + summarize +
 * tag via the Edge Function; falls back to just saving the link if that fails.
 * Returns { note, scraped }.
 */
export async function createNoteFromUrl(url) {
  const clean = String(url || '').trim()
  if (!isUrl(clean)) throw new Error('That doesn’t look like a valid URL')
  const folder_id = await getOrCreateUploadsFolder()

  let title = clean
  let content = null
  let contentText = clean
  let tags = []
  let scraped = false

  try {
    // Cap the scrape so an unreachable/slow function can't hang the UI.
    const result = await Promise.race([
      summarizeUrl(clean),
      new Promise((_, reject) => setTimeout(() => reject(new Error('scrape timeout')), 25000)),
    ])
    if (result?.tiptap_content) {
      content = result.tiptap_content
      title = result.title || clean
      contentText = [result.title, result.summary, ...(result.key_points || [])].filter(Boolean).join('\n') || clean
      tags = Array.isArray(result.tags) ? result.tags : []
      scraped = true
    }
  } catch {
    // Edge Function not deployed / scrape failed — save the link below.
  }

  if (!content) {
    content = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Source: ' },
          { type: 'text', marks: [{ type: 'link', attrs: { href: clean } }], text: clean },
        ],
      }],
    }
  }

  const note = await createNote({
    title: String(title).slice(0, 120),
    content,
    content_text: contentText,
    folder_id,
  })
  useStore.getState().addNote(note)

  if (tags.length) {
    try { await applyTags(note.id, tags) } catch { /* non-fatal */ }
  }
  return { note, scraped }
}
