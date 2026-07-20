import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Loader2, Sparkles, X } from 'lucide-react'
import { useStore } from '../lib/store'
import { smartSearch } from '../lib/ai'
import { supabase } from '../lib/supabase'

export default function SearchModal() {
  const navigate = useNavigate()
  const { setSearchOpen, isOnline } = useStore()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [useAI, setUseAI] = useState(isOnline)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const fullTextSearch = useCallback(async (q) => {
    const { data, error } = await supabase
      .from('notes')
      .select('id, title, folder_id, updated_at')
      .textSearch('fts', q, { type: 'websearch', config: 'english' })
      .limit(15)
    if (error) throw error
    return data || []
  }, [])

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      if (useAI && isOnline) {
        try {
          const { results: r } = await smartSearch(q, 15)
          setResults(r || [])
          return
        } catch (e) {
          // AI search (Edge Function) not available — fall back to keyword search.
          console.warn('AI search unavailable, using keyword search', e)
        }
      }
      setResults(await fullTextSearch(q))
    } catch (e) {
      console.error('Search error', e)
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [useAI, isOnline, fullTextSearch])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(query), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, search])

  useEffect(() => { setSelectedIdx(0) }, [results])

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setSearchOpen(false); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && results[selectedIdx]) {
      navigate(`/note/${results[selectedIdx].id}`)
      setSearchOpen(false)
    }
  }

  function selectResult(r) {
    navigate(`/note/${r.id}`)
    setSearchOpen(false)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-24 z-50 px-4"
      onClick={() => setSearchOpen(false)}
    >
      <div
        className="bg-surface-1 border border-surface-2 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-2">
          {loading ? <Loader2 size={16} className="text-accent animate-spin shrink-0"/> : <Search size={16} className="text-ink-faint shrink-0"/>}
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search notes…"
            className="flex-1 bg-transparent text-ink outline-none placeholder-ink-faint text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseAI(!useAI)}
              title={useAI ? 'AI search on' : 'AI search off'}
              className={`p-1 rounded transition-colors ${useAI && isOnline ? 'text-accent' : 'text-ink-faint'}`}
            >
              <Sparkles size={14}/>
            </button>
            <button onClick={() => setSearchOpen(false)} className="text-ink-faint hover:text-ink">
              <X size={14}/>
            </button>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {results.length === 0 && query && !loading && (
            <div className="px-4 py-6 text-center text-sm text-ink-faint">No results for "{query}"</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.id}
              onClick={() => selectResult(r)}
              className={`w-full text-left flex items-center gap-3 px-4 py-3 transition-colors ${i === selectedIdx ? 'bg-surface-2' : 'hover:bg-surface-2'}`}
            >
              <span className="text-base">📄</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate">{r.title || 'Untitled'}</div>
                {r.score !== undefined && (
                  <div className="text-xs text-ink-faint mt-0.5">
                    {r.bm25_score > 0 && <span className="mr-2">BM25: {r.bm25_score.toFixed(3)}</span>}
                    {r.vec_score > 0 && <span>Vector: {(r.vec_score * 100).toFixed(0)}%</span>}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-surface-2 text-xs text-ink-faint flex gap-3">
          <span><kbd className="bg-surface-2 px-1 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="bg-surface-2 px-1 rounded">↵</kbd> open</span>
          <span><kbd className="bg-surface-2 px-1 rounded">esc</kbd> close</span>
          {useAI && isOnline && <span className="ml-auto text-accent flex items-center gap-1"><Sparkles size={10}/>AI hybrid search</span>}
        </div>
      </div>
    </div>
  )
}
