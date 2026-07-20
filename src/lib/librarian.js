/**
 * The "AI librarian": retroactively tags notes and links unlinked mentions.
 *
 * - Tag application reuses the existing tag vocabulary and never removes tags
 *   you added by hand (it unions).
 * - Linking rewrites the note's TipTap JSON, wrapping the first standalone,
 *   non-code mention of another note's title in `[[Canonical Title]]`. The
 *   canonical (exact) title is used so the link resolves in the links table
 *   (syncLinks matches titles case-sensitively).
 */
import {
  fetchNote, updateNote,
  fetchNoteTags, fetchTags, createTag, setNoteTags,
  syncLinks,
} from './supabase'
import { organizeNote as aiOrganize, extractWikiLinks } from './ai'
import { useStore } from './store'
import { docToText, computeCandidateTitles, applyWikiLinks } from './librarian-core'

const NEW_TAG_COLOR = '#6366f1'

// ── Orchestration ────────────────────────────────────────────────────────────

async function applyTags(noteId, tagNames) {
  const names = [...new Set(tagNames.map((t) => String(t).toLowerCase().trim()).filter(Boolean))]
  if (!names.length) return 0
  const [current, existing] = await Promise.all([fetchNoteTags(noteId), fetchTags()])
  const ids = new Set(current.map((t) => t.id))
  let added = 0
  for (const name of names) {
    let tag = existing.find((t) => t.name.toLowerCase() === name)
    if (!tag) { tag = await createTag({ name, color: NEW_TAG_COLOR }); existing.push(tag) }
    if (!ids.has(tag.id)) { ids.add(tag.id); added++ }
  }
  useStore.getState().setTags(existing)
  await setNoteTags(noteId, [...ids])
  return added
}

/**
 * Tag + link a single note. Returns { title, tagsAdded, linksAdded, skipped }.
 */
export async function organizeSingleNote(noteId, { tags = true, links = true } = {}) {
  const note = await fetchNote(noteId)
  const doc = note.content && typeof note.content === 'object' && Object.keys(note.content).length
    ? note.content
    : { type: 'doc', content: [] }
  const text = docToText(doc)
  if (!text.trim()) return { title: note.title, tagsAdded: 0, linksAdded: 0, skipped: true }

  const allNotes = useStore.getState().notes
  const candidateTitles = links ? computeCandidateTitles(doc, allNotes, noteId) : []
  const existingTags = (useStore.getState().tags || []).map((t) => t.name)

  let ai = { tags: [], link_titles: [] }
  try {
    ai = await aiOrganize({ title: note.title, text, existingTags, candidateTitles })
  } catch {
    return { title: note.title, tagsAdded: 0, linksAdded: 0, error: true }
  }

  let tagsAdded = 0
  let linksAdded = 0

  if (tags && Array.isArray(ai.tags) && ai.tags.length) {
    tagsAdded = await applyTags(noteId, ai.tags)
  }

  if (links && Array.isArray(ai.link_titles) && ai.link_titles.length) {
    // Map the model's answers back to the exact candidate titles.
    const canonical = ai.link_titles
      .map((t) => candidateTitles.find((c) => c.toLowerCase() === String(t).toLowerCase()))
      .filter(Boolean)
    if (canonical.length) {
      const { doc: newDoc, applied } = applyWikiLinks(doc, canonical)
      if (applied.length) {
        const newText = docToText(newDoc)
        const updatedAt = new Date().toISOString()
        await updateNote(noteId, { content: newDoc, content_text: newText, updated_at: updatedAt })
        useStore.getState().updateNoteInList(noteId, { updated_at: updatedAt })
        // Rebuild the links table from every wiki-link now in the doc.
        const linkedTitles = extractWikiLinks(newDoc)
        const notes = useStore.getState().notes
        const targetIds = linkedTitles
          .map((t) => notes.find((n) => n.title === t)?.id)
          .filter(Boolean)
        await syncLinks(noteId, targetIds)
        linksAdded = applied.length
      }
    }
  }

  return { title: note.title, tagsAdded, linksAdded }
}

/**
 * Sweep every note sequentially (gentle on API rate limits).
 * @param {object} opts
 * @param {(p: object) => void} opts.onProgress
 * @param {() => boolean} opts.shouldCancel
 */
export async function organizeVault({ onProgress, shouldCancel } = {}) {
  const notes = [...useStore.getState().notes]
  const summary = { total: notes.length, processed: 0, tagsAdded: 0, linksAdded: 0, errors: 0, cancelled: false }
  for (const n of notes) {
    if (shouldCancel?.()) { summary.cancelled = true; break }
    try {
      const r = await organizeSingleNote(n.id, { tags: true, links: true })
      summary.tagsAdded += r.tagsAdded || 0
      summary.linksAdded += r.linksAdded || 0
      if (r.error) summary.errors++
    } catch {
      summary.errors++
    }
    summary.processed++
    onProgress?.({ ...summary, current: n.title })
    await new Promise((res) => setTimeout(res, 150))
  }
  return summary
}
