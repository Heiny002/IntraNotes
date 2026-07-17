import { useEffect, useState } from 'react'
import { Tag, Plus, Loader2, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { fetchNoteTags, setNoteTags, createTag, fetchTags } from '../lib/supabase'
import toast from 'react-hot-toast'

const TAG_COLORS = ['#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6','#8b5cf6','#f97316']

export default function TagBrowser({ noteId }) {
  const { tags: allTags, setTags } = useStore()
  const [noteTags, setNoteTagsState] = useState([])
  const [loading, setLoading] = useState(true)
  const [newTagName, setNewTagName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!noteId) return
    setLoading(true)
    fetchNoteTags(noteId)
      .then(setNoteTagsState)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [noteId])

  async function toggleTag(tag) {
    const has = noteTags.some((t) => t.id === tag.id)
    const next = has ? noteTags.filter((t) => t.id !== tag.id) : [...noteTags, tag]
    setNoteTagsState(next)
    try {
      await setNoteTags(noteId, next.map((t) => t.id))
    } catch (e) {
      toast.error(e.message)
      // revert
      setNoteTagsState(noteTags)
    }
  }

  async function handleCreateTag(e) {
    e.preventDefault()
    if (!newTagName.trim()) return
    setCreating(true)
    try {
      const color = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
      const tag = await createTag({ name: newTagName.trim().toLowerCase(), color })
      const refreshed = await fetchTags()
      setTags(refreshed)
      await toggleTag(tag)
      setNewTagName('')
    } catch (e) {
      toast.error(e.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-2">
        <Tag size={15} className="text-accent"/>
        <h3 className="text-sm font-semibold text-white">Tags</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* This note's tags */}
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-ink-faint"/></div>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-2">This note</p>
              <div className="flex flex-wrap gap-1.5">
                {noteTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer group"
                    style={{ background: tag.color + '33', color: tag.color, border: `1px solid ${tag.color}66` }}
                    onClick={() => toggleTag(tag)}
                  >
                    {tag.name}
                    <X size={10} className="opacity-0 group-hover:opacity-100"/>
                  </span>
                ))}
                {noteTags.length === 0 && <span className="text-xs text-ink-faint italic">No tags yet</span>}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-ink-faint uppercase tracking-wider mb-2">All tags</p>
              <div className="flex flex-wrap gap-1.5">
                {allTags.map((tag) => {
                  const active = noteTags.some((t) => t.id === tag.id)
                  return (
                    <span
                      key={tag.id}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer transition-all ${active ? 'ring-2 ring-offset-1 ring-offset-surface-1' : 'opacity-60 hover:opacity-100'}`}
                      style={{
                        background: tag.color + '22',
                        color: tag.color,
                        border: `1px solid ${tag.color}55`,
                        ringColor: tag.color,
                      }}
                      onClick={() => toggleTag(tag)}
                    >
                      {tag.name}
                    </span>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* New tag form */}
      <form onSubmit={handleCreateTag} className="px-3 py-3 border-t border-surface-2 flex gap-2">
        <input
          type="text"
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="New tag…"
          className="flex-1 bg-surface-2 border border-surface-3 rounded-lg px-2 py-1.5 text-xs text-ink outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={creating || !newTagName.trim()}
          className="p-1.5 bg-accent hover:bg-accent-hover rounded-lg text-white disabled:opacity-40"
        >
          {creating ? <Loader2 size={12} className="animate-spin"/> : <Plus size={12}/>}
        </button>
      </form>
    </div>
  )
}
