/**
 * Generates supabase/migrations/004_howto_note.sql — a "How to use IntraNotes"
 * guide seeded as a default note (TipTap JSON in notes.content).
 *
 * Run:  node scripts/gen-howto-note.mjs
 */
import { writeFileSync } from 'fs'

const ROOT_FOLDER = '00000000-0000-0000-0000-000000000001'
const TITLE = 'How to use IntraNotes'

// ── Tiny TipTap node builders ────────────────────────────────────────────────
const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t })
const bold = (t) => text(t, [{ type: 'bold' }])
const code = (t) => text(t, [{ type: 'code' }])
const h = (level, ...content) => ({ type: 'heading', attrs: { level }, content })
const p = (...content) => ({ type: 'paragraph', content: content.length ? content : undefined })
const li = (...content) => ({ type: 'listItem', content })
const ul = (...items) => ({ type: 'bulletList', content: items })
const hr = () => ({ type: 'horizontalRule' })

// ── The guide ────────────────────────────────────────────────────────────────
const doc = {
  type: 'doc',
  content: [
    h(1, text('How to use IntraNotes 📓')),
    p(text('IntraNotes is your personal knowledge base — rich notes, wiki-style links, tags, a graph view, drawing, and optional AI. This guide walks through everything. Feel free to edit or delete it once you know your way around.')),

    h(2, text('1. Notes & folders')),
    ul(
      li(p(text('Hover a folder in the left sidebar to reveal '), bold('＋ note'), text(' and '), bold('＋ folder'), text(' buttons.'))),
      li(p(text('Click a note to open it. Give it a title at the top, then start writing below.'))),
      li(p(text('Everything you type '), bold('auto-saves'), text(' about 1.5 seconds after you stop — watch the “Saving / Saved” indicator in the top-right of the toolbar.'))),
      li(p(text('Hover a note and click '), code('×'), text(' to delete it.'))),
    ),

    h(2, text('2. Formatting')),
    p(text('The toolbar above each note covers the essentials:')),
    ul(
      li(p(bold('Text:'), text(' bold, italic, underline, strikethrough, inline code'))),
      li(p(bold('Lists:'), text(' bullet, numbered, and checkable task lists'))),
      li(p(bold('Blocks:'), text(' tables, code blocks with syntax highlighting, alignment'))),
      li(p(bold('Media:'), text(' upload images, or open the drawing pad (see §6)'))),
    ),

    h(2, text('3. Link your notes with [[wiki-links]]')),
    p(text('This is the heart of IntraNotes. Type two square brackets around a note’s title to link to it:')),
    ul(
      li(p(code('[[Note title]]'), text(' becomes a clickable link.'))),
      li(p(text('Click a link to jump to that note — or, if it doesn’t exist yet, IntraNotes '), bold('creates it for you'), text(' on the spot.'))),
      li(p(text('Try it now, this is a real link: '), text('[[My First Note]]', [{ type: 'code' }]), text(' — click it to create that note.'))),
    ),
    p(bold('Backlinks:'), text(' open the backlinks panel (the dashboard icon in the sidebar) to see every note that links to the one you’re viewing. Connections build themselves as you write.')),

    h(2, text('4. Tags')),
    ul(
      li(p(text('Open the '), bold('Tags'), text(' panel (tag icon in the sidebar) while a note is open.'))),
      li(p(text('Create a colored tag and click to apply or remove it. Tags are shared across all notes, so you can group ideas across folders.'))),
    ),

    h(2, text('5. Find anything — ⌘K')),
    ul(
      li(p(text('Press '), code('⌘K'), text(' (or '), code('Ctrl+K'), text(') anywhere to open search.'))),
      li(p(text('Navigate results with '), code('↑'), text(' / '), code('↓'), text(' and press '), code('Enter'), text(' to open.'))),
      li(p(text('Toggle the '), bold('✨ sparkle'), text(' for AI hybrid search (keyword + meaning). Without AI it falls back to fast keyword search.'))),
    ),

    h(2, text('6. Graph, drawing & images')),
    ul(
      li(p(bold('Graph view'), text(' (branch icon): a force-directed map of every note and link. Click a node to jump to it; drag to rearrange.'))),
      li(p(bold('Drawing pad'), text(' (pen icon in a note’s toolbar): sketch with Excalidraw and insert it into the note as an image.'))),
      li(p(bold('Images'), text(' (image icon): upload a picture straight into a note.'))),
    ),

    h(2, text('7. AI features (optional)')),
    p(text('These need the Supabase Edge Functions deployed with API keys. If they aren’t set up yet, the rest of the app still works fully.')),
    ul(
      li(p(bold('Suggest links'), text(' (✨ in a note): finds semantically related notes and explains why.'))),
      li(p(bold('Summarize a URL'), text(' (link icon): paste a web address and get a structured, summarized note.'))),
      li(p(bold('AI hybrid search'), text(': smarter '), code('⌘K'), text(' results that understand meaning, not just keywords.'))),
    ),

    h(2, text('8. Works offline')),
    ul(
      li(p(text('IntraNotes is a '), bold('PWA'), text(' — install it from your browser’s address bar for an app-like window.'))),
      li(p(text('Recent notes are cached, and edits you make offline are queued and synced automatically when you reconnect (watch the counter badge in the sidebar).'))),
    ),

    hr(),
    p(text('That’s the whole tour. Delete this note whenever you like — or keep it around as a reference. Happy note-taking! 🚀')),
  ],
}

// ── Derive plain text for the fts/content_text column ────────────────────────
function toText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.text || ''
  if (Array.isArray(node.content)) {
    const inner = node.content.map(toText).join('')
    return /^(heading|paragraph|listItem)$/.test(node.type) ? inner + '\n' : inner
  }
  return ''
}
const contentText = toText(doc).replace(/\n{2,}/g, '\n').trim()

// ── Emit idempotent SQL ──────────────────────────────────────────────────────
// Use dollar-quoting for the JSON and text blobs so no apostrophe/quote/newline
// in the note prose can ever break the statement (robust to copy-paste too).
const TAG = 'intranotes_howto'
const contentJson = JSON.stringify(doc)

// Safety: dollar-quote tag must not appear inside the content.
const marker = `$${TAG}$`
if (contentJson.includes(marker) || contentText.includes(marker)) {
  throw new Error(`Dollar-quote tag ${marker} collides with content; choose another tag.`)
}

const sql = `-- Default "How to use IntraNotes" guide note.
-- Idempotent: only inserts if a note with this title does not already exist.
-- JSON/text use dollar-quoting ($${TAG}$) so no escaping is needed.

insert into notes (title, content, content_text, folder_id)
select
  '${TITLE.replace(/'/g, "''")}',
  $${TAG}$${contentJson}$${TAG}$::jsonb,
  $${TAG}$${contentText}$${TAG}$,
  '${ROOT_FOLDER}'
where not exists (
  select 1 from notes where title = '${TITLE.replace(/'/g, "''")}'
);
`

writeFileSync('supabase/migrations/004_howto_note.sql', sql)
console.log('Wrote supabase/migrations/004_howto_note.sql')
console.log('content_text length:', contentText.length)
console.log('doc top-level blocks:', doc.content.length)
