import { supabase } from './supabase'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function callFunction(name, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error ?? `Edge Function ${name} failed`)
  }
  return res.json()
}

/**
 * Trigger embedding generation for a note (fire-and-forget friendly)
 */
export async function generateEmbedding(noteId, text) {
  return callFunction('generate-embedding', { note_id: noteId, text })
}

/**
 * Get AI-powered link suggestions for a note
 * @returns {Promise<Array<{id, title, reason, vec_score}>>}
 */
export async function suggestLinks(noteId, text, limit = 5) {
  const { suggestions } = await callFunction('suggest-links', { note_id: noteId, text, limit })
  return suggestions ?? []
}

/**
 * Summarize a URL into a structured note
 * @returns {Promise<{title, summary, key_points, tags, source, tiptap_content}>}
 */
export async function summarizeUrl(url) {
  return callFunction('summarize-url', { url })
}

/**
 * Librarian: get tags + which candidate titles are genuine references for a note.
 * @returns {Promise<{tags: string[], link_titles: string[]}>}
 */
export async function organizeNote({ title, text, existingTags, candidateTitles }) {
  return callFunction('organize-note', {
    title,
    text,
    existing_tags: existingTags ?? [],
    candidate_titles: candidateTitles ?? [],
  })
}

/**
 * Hybrid QMD search
 * @returns {Promise<{results: Array, decomposed: object}>}
 */
export async function smartSearch(query, limit = 15) {
  return callFunction('smart-search', { query, limit })
}

/**
 * Extract all [[Note Title]] wiki-link targets from TipTap JSON content
 */
export function extractWikiLinks(tiptapJson) {
  const titles = new Set()
  function walk(node) {
    if (!node) return
    if (node.type === 'wikiLink' && node.attrs?.title) {
      titles.add(node.attrs.title)
    }
    if (node.marks) {
      node.marks.forEach((m) => {
        if (m.type === 'wikiLink' && m.attrs?.title) titles.add(m.attrs.title)
      })
    }
    if (node.content) node.content.forEach(walk)
  }
  walk(tiptapJson)
  // Also scan raw text for [[...]] patterns
  const rawText = JSON.stringify(tiptapJson)
  const pattern = /\[\[([^\]]+)\]\]/g
  let match
  while ((match = pattern.exec(rawText)) !== null) {
    titles.add(match[1].trim())
  }
  return [...titles]
}
