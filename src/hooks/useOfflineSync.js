import { useEffect, useCallback } from 'react'
import { useStore } from '../lib/store'
import { flushOutbox, getOutboxCount } from '../lib/offline'
import { updateNote, createNote, deleteNote } from '../lib/supabase'

/**
 * Listens for online events and flushes the IndexedDB outbox to Supabase.
 */
export function useOfflineSync() {
  const { isOnline, setOutboxCount } = useStore()

  const flush = useCallback(async () => {
    await flushOutbox(async (entry) => {
      const { table_name, operation, record_id, payload } = entry
      if (table_name === 'notes') {
        if (operation === 'insert') await createNote(payload)
        if (operation === 'update') await updateNote(record_id, payload)
        if (operation === 'delete') await deleteNote(record_id)
      }
      // Extend for other tables as needed
    })
    const count = await getOutboxCount()
    setOutboxCount(count)
  }, [setOutboxCount])

  useEffect(() => {
    if (isOnline) flush()
  }, [isOnline, flush])
}
