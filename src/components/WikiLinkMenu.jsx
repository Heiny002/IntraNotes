import { FileText, Plus } from 'lucide-react'

/**
 * Floating dropdown for [[wiki-link]] autocomplete. Positioned at (x, y) in
 * viewport coordinates. `items` are { type: 'note'|'create', key, title, score }.
 */
export default function WikiLinkMenu({ x, y, items, activeIndex, onHover, onSelect, menuRef }) {
  return (
    <div
      ref={menuRef}
      className="fixed z-[60] w-64 max-w-[80vw] rounded-lg border border-surface-2 bg-surface-1 shadow-2xl overflow-hidden py-1"
      style={{ left: x, top: y }}
    >
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          onMouseEnter={() => onHover(i)}
          // mousedown (not click) + preventDefault so the editor keeps focus/selection
          onMouseDown={(e) => { e.preventDefault(); onSelect(it) }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm ${
            i === activeIndex ? 'bg-surface-2 text-white' : 'text-ink-muted'
          }`}
        >
          {it.type === 'create'
            ? <Plus size={14} className="text-accent shrink-0" />
            : <FileText size={14} className="text-ink-faint shrink-0" />}
          <span className="flex-1 truncate">
            {it.type === 'create' ? <>Create new note “{it.title}”</> : it.title}
          </span>
          {it.type !== 'create' && it.score != null && (
            <span className="text-xs text-ink-faint">{Math.round(it.score * 100)}%</span>
          )}
        </button>
      ))}
    </div>
  )
}
