import { useRef, useCallback } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import { X, Download, Check } from 'lucide-react'

export default function DrawingPad({ noteId, onClose, onSave }) {
  const excalidrawRef = useRef(null)

  const handleSave = useCallback(async () => {
    if (!excalidrawRef.current) return
    const { exportToSvg } = await import('@excalidraw/excalidraw')
    const elements = excalidrawRef.current.getSceneElements()
    const appState = excalidrawRef.current.getAppState()

    try {
      // Export to SVG and convert to data URL
      const svg = await exportToSvg({
        elements,
        appState: { ...appState, exportBackground: true },
        files: excalidrawRef.current.getFiles(),
      })
      const svgString = new XMLSerializer().serializeToString(svg)
      const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`
      onSave(dataUrl)
    } catch (err) {
      // Fallback: export as PNG via canvas
      const { exportToCanvas } = await import('@excalidraw/excalidraw')
      const canvas = await exportToCanvas({
        elements,
        appState,
        files: excalidrawRef.current.getFiles(),
      })
      const dataUrl = canvas.toDataURL('image/png')
      onSave(dataUrl)
    }
  }, [onSave])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-surface-0 border-b border-surface-2 shrink-0">
        <span className="text-white font-semibold text-sm">Drawing Pad</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 bg-accent hover:bg-accent-hover text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
          >
            <Check size={14}/>
            Insert into note
          </button>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-surface-2 text-ink-muted hover:text-ink">
            <X size={16}/>
          </button>
        </div>
      </div>

      {/* Excalidraw canvas */}
      <div className="flex-1 bg-white">
        <Excalidraw
          ref={excalidrawRef}
          theme="dark"
          UIOptions={{
            canvasActions: { changeViewBackgroundColor: true, clearCanvas: true },
          }}
        />
      </div>
    </div>
  )
}
