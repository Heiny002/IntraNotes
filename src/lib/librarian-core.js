/**
 * Pure helpers for the AI librarian — no I/O, no imports, so they can be unit
 * tested in isolation. See librarian.js for the orchestration that uses them.
 */

const MIN_TITLE_LEN = 3

/** Plain text from a TipTap doc (a newline after each block). */
export function docToText(doc) {
  let out = ''
  function walk(node) {
    if (!node) return
    if (node.type === 'text') { out += node.text || ''; return }
    if (Array.isArray(node.content)) node.content.forEach(walk)
    if (/^(paragraph|heading|listItem|blockquote|codeBlock)$/.test(node.type)) out += '\n'
  }
  walk(doc)
  return out.replace(/\n{2,}/g, '\n').trim()
}

/**
 * First standalone, non-bracketed occurrence of `title` in `text`
 * (case-insensitive). Returns the index, or -1. Avoids regex lookbehind so it
 * works on every browser and handles titles with special characters.
 */
export function findStandalone(text, title) {
  const hay = text.toLowerCase()
  const needle = title.toLowerCase()
  if (!needle) return -1
  let from = 0
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from)
    if (idx === -1) return -1
    const before = idx > 0 ? text[idx - 1] : ''
    const after = idx + needle.length < text.length ? text[idx + needle.length] : ''
    const wordBefore = /\w/.test(before)
    const wordAfter = /\w/.test(after)
    if (!wordBefore && !wordAfter && before !== '[' && after !== ']') return idx
    from = idx + 1
  }
  return -1
}

/** Titles of other notes that are mentioned in `doc` but not already linked. */
export function computeCandidateTitles(doc, allNotes, selfId) {
  const text = docToText(doc)
  const seen = new Set()
  const out = []
  for (const n of allNotes) {
    if (n.id === selfId) continue
    const title = (n.title || '').trim()
    const key = title.toLowerCase()
    if (title.length < MIN_TITLE_LEN || seen.has(key)) continue
    seen.add(key)
    if (findStandalone(text, title) !== -1) out.push(title)
  }
  return out
}

function transform(node, title, ctx, inCode) {
  if (node.type === 'text') {
    if (ctx.done || !node.text) return node
    const hasCodeMark = node.marks?.some((m) => m.type === 'code')
    if (inCode || hasCodeMark) return node
    const idx = findStandalone(node.text, title)
    if (idx === -1) return node
    ctx.done = true
    const end = idx + title.length
    const pieces = []
    const before = node.text.slice(0, idx)
    const after = node.text.slice(end)
    if (before) pieces.push({ ...node, text: before })
    pieces.push({ type: 'text', text: `[[${title}]]` }) // plain text; decoration styles it
    if (after) pieces.push({ ...node, text: after })
    return pieces
  }
  if (Array.isArray(node.content)) {
    const childInCode = inCode || node.type === 'codeBlock' || node.type === 'codeBlockLowlight'
    const content = []
    for (const child of node.content) {
      const res = transform(child, title, ctx, childInCode)
      if (Array.isArray(res)) content.push(...res)
      else content.push(res)
    }
    return { ...node, content }
  }
  return node
}

/**
 * Wrap the first mention of each title in `[[Title]]`. Longest titles first so
 * "Machine Learning" wins over "Learning". Returns { doc, applied }.
 */
export function applyWikiLinks(doc, titlesToLink) {
  let current = JSON.parse(JSON.stringify(doc))
  const applied = []
  const sorted = [...new Set(titlesToLink)].sort((a, b) => b.length - a.length)
  for (const title of sorted) {
    const ctx = { done: false }
    const next = transform(current, title, ctx, false)
    if (ctx.done) { current = next; applied.push(title) }
  }
  return { doc: current, applied }
}
