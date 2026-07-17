import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useStore } from '../lib/store'
import { cacheNote } from '../lib/offline'

/**
 * Subscribes to Supabase Realtime changes on the notes table.
 * Updates the local Zustand store in real time.
 */
export function useRealtimeSync() {
  const { updateNoteInList, addNote, removeNote } = useStore()

  useEffect(() => {
    const channel = supabase
      .channel('notes-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, (payload) => {
        addNote(payload.new)
        cacheNote(payload.new)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes' }, (payload) => {
        updateNoteInList(payload.new.id, payload.new)
        cacheNote(payload.new)
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes' }, (payload) => {
        removeNote(payload.old.id)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [addNote, updateNoteInList, removeNote])
}
