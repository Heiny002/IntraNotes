/**
 * IndexedDB offline cache & sync queue
 * Uses the `idb` helper library for promise-based access.
 */
import { openDB } from 'idb'

const DB_NAME = 'intranotes'
const DB_VERSION = 1
const NOTE_CACHE_LIMIT = 100

let _db = null

async function getDB() {
  if (_db) return _db
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Notes cache
      const notesStore = db.createObjectStore('notes', { keyPath: 'id' })
      notesStore.createIndex('updated_at', 'updated_at')

      // Folders cache
      db.createObjectStore('folders', { keyPath: 'id' })

      // Outbox for offline mutations
      const outbox = db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true })
      outbox.createIndex('table_name', 'table_name')
    },
  })
  return _db
}

// ── Note cache ─────────────────────────────────────────────────────────────

export async function cacheNote(note) {
  const db = await getDB()
  await db.put('notes', { ...note, _cached_at: Date.now() })
  await pruneNoteCache()
}

export async function getCachedNote(id) {
  const db = await getDB()
  return db.get('notes', id)
}

export async function getCachedNotes() {
  const db = await getDB()
  return db.getAll('notes')
}

export async function pruneNoteCache() {
  const db = await getDB()
  const all = await db.getAllFromIndex('notes', 'updated_at')
  if (all.length <= NOTE_CACHE_LIMIT) return
  const toDelete = all.slice(0, all.length - NOTE_CACHE_LIMIT)
  const tx = db.transaction('notes', 'readwrite')
  await Promise.all(toDelete.map((n) => tx.store.delete(n.id)))
  await tx.done
}

export async function removeCachedNote(id) {
  const db = await getDB()
  await db.delete('notes', id)
}

// ── Folder cache ───────────────────────────────────────────────────────────

export async function cacheFolders(folders) {
  const db = await getDB()
  const tx = db.transaction('folders', 'readwrite')
  await Promise.all(folders.map((f) => tx.store.put(f)))
  await tx.done
}

export async function getCachedFolders() {
  const db = await getDB()
  return db.getAll('folders')
}

// ── Outbox (offline mutation queue) ───────────────────────────────────────

export async function enqueueOutbox(entry) {
  const db = await getDB()
  await db.add('outbox', { ...entry, queued_at: Date.now() })
}

export async function flushOutbox(processEntry) {
  const db = await getDB()
  const all = await db.getAll('outbox')
  for (const entry of all) {
    try {
      await processEntry(entry)
      await db.delete('outbox', entry.id)
    } catch (err) {
      console.warn('[offline] Failed to sync outbox entry', entry, err)
    }
  }
}

export async function getOutboxCount() {
  const db = await getDB()
  return db.count('outbox')
}
