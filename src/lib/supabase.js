import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Copy .env.example → .env and fill in values.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
})

// ── Notes ──────────────────────────────────────────────────────────────────

export async function fetchNotes(folderId = null) {
  let q = supabase.from('notes').select('id, title, folder_id, is_pinned, word_count, updated_at').order('updated_at', { ascending: false })
  if (folderId) q = q.eq('folder_id', folderId)
  const { data, error } = await q
  if (error) throw error
  return data
}

export async function fetchNote(id) {
  const { data, error } = await supabase.from('notes').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function createNote(note) {
  const { data, error } = await supabase.from('notes').insert(note).select().single()
  if (error) throw error
  return data
}

export async function updateNote(id, updates) {
  const { data, error } = await supabase.from('notes').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteNote(id) {
  const { error } = await supabase.from('notes').delete().eq('id', id)
  if (error) throw error
}

// ── Folders ────────────────────────────────────────────────────────────────

export async function fetchFolders() {
  const { data, error } = await supabase.from('folders').select('*').order('order')
  if (error) throw error
  return data
}

export async function createFolder(folder) {
  const { data, error } = await supabase.from('folders').insert(folder).select().single()
  if (error) throw error
  return data
}

export async function updateFolder(id, updates) {
  const { data, error } = await supabase.from('folders').update(updates).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteFolder(id) {
  const { error } = await supabase.from('folders').delete().eq('id', id)
  if (error) throw error
}

// ── Links / Backlinks ──────────────────────────────────────────────────────

export async function fetchBacklinks(noteId) {
  const { data, error } = await supabase
    .from('links')
    .select('id, source_note_id, notes!links_source_note_id_fkey(id, title)')
    .eq('target_note_id', noteId)
  if (error) throw error
  return data
}

export async function syncLinks(sourceNoteId, targetNoteIds) {
  // Delete old links from this source
  await supabase.from('links').delete().eq('source_note_id', sourceNoteId)
  if (targetNoteIds.length === 0) return
  const rows = targetNoteIds.map((tid) => ({ source_note_id: sourceNoteId, target_note_id: tid }))
  const { error } = await supabase.from('links').insert(rows)
  if (error) throw error
}

// ── Tags ───────────────────────────────────────────────────────────────────

export async function fetchTags() {
  const { data, error } = await supabase.from('tags').select('*').order('name')
  if (error) throw error
  return data
}

export async function fetchNoteTags(noteId) {
  const { data, error } = await supabase
    .from('note_tags')
    .select('tag_id, tags(id, name, color)')
    .eq('note_id', noteId)
  if (error) throw error
  return data.map((r) => r.tags)
}

export async function setNoteTags(noteId, tagIds) {
  await supabase.from('note_tags').delete().eq('note_id', noteId)
  if (tagIds.length === 0) return
  const rows = tagIds.map((tid) => ({ note_id: noteId, tag_id: tid }))
  const { error } = await supabase.from('note_tags').insert(rows)
  if (error) throw error
}

export async function createTag(tag) {
  const { data, error } = await supabase.from('tags').insert(tag).select().single()
  if (error) throw error
  return data
}

// ── Media ──────────────────────────────────────────────────────────────────

export async function uploadMedia(noteId, file) {
  const ext = file.name.split('.').pop()
  const path = `${noteId}/${Date.now()}.${ext}`
  const { error: uploadErr } = await supabase.storage.from('media').upload(path, file)
  if (uploadErr) throw uploadErr
  const { data: urlData } = supabase.storage.from('media').getPublicUrl(path)
  const { data, error } = await supabase.from('media').insert({
    note_id: noteId,
    storage_path: path,
    media_type: file.type.startsWith('video') ? 'video' : 'image',
    filename: file.name,
    size_bytes: file.size,
  }).select().single()
  if (error) throw error
  return { ...data, public_url: urlData.publicUrl }
}

export async function fetchMedia(noteId) {
  const { data, error } = await supabase.from('media').select('*').eq('note_id', noteId)
  if (error) throw error
  return data.map((m) => ({
    ...m,
    public_url: supabase.storage.from('media').getPublicUrl(m.storage_path).data.publicUrl,
  }))
}

// ── Graph data ─────────────────────────────────────────────────────────────

export async function fetchGraphData() {
  const [{ data: notes }, { data: links }] = await Promise.all([
    supabase.from('notes').select('id, title'),
    supabase.from('links').select('source_note_id, target_note_id'),
  ])
  return {
    nodes: (notes || []).map((n) => ({ id: n.id, label: n.title })),
    links: (links || []).map((l) => ({ source: l.source_note_id, target: l.target_note_id })),
  }
}
