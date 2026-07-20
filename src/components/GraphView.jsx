import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw } from 'lucide-react'
import { fetchGraphData } from '../lib/supabase'
import { useStore } from '../lib/store'
import * as d3 from 'd3'

// Edge styling by kind.
const EDGE = {
  strong: { color: '#6366f1', width: 1.6, dash: null, distance: 70, strength: 0.5 },   // wiki-links / backlinks
  tag:    { color: '#a855f7', width: 1.1, dash: '4,4', distance: 130, strength: 0.05 }, // shared tag (soft)
  folder: { color: '#3b82f6', width: 1.0, dash: '2,4', distance: 150, strength: 0.04 }, // same folder (soft)
}

// Don't fully connect very large groups (folders/tags) — it turns the graph
// into an unreadable hairball. Those groups still cluster via other edges.
const GROUP_CAP = 30

function buildEdges(graphData, show) {
  const nodeIds = new Set(graphData.nodes.map((n) => n.id))
  const edges = []
  const strongPairs = new Set()
  const softSeen = new Set()
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

  if (show.strong) {
    for (const l of graphData.links) {
      if (l.source === l.target || !nodeIds.has(l.source) || !nodeIds.has(l.target)) continue
      edges.push({ source: l.source, target: l.target, kind: 'strong' })
      strongPairs.add(pairKey(l.source, l.target))
    }
  }

  const addGroup = (ids, kind) => {
    if (ids.length < 2 || ids.length > GROUP_CAP) return
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const k = pairKey(ids[i], ids[j])
        if (strongPairs.has(k) || softSeen.has(k)) continue
        softSeen.add(k)
        edges.push({ source: ids[i], target: ids[j], kind })
      }
    }
  }

  // Tags first so a shared-tag edge wins over a same-folder edge for a pair.
  if (show.tag) {
    const byTag = {}
    for (const nt of graphData.noteTags || []) {
      if (!nodeIds.has(nt.note_id)) continue
      ;(byTag[nt.tag_id] ??= []).push(nt.note_id)
    }
    Object.values(byTag).forEach((ids) => addGroup(ids, 'tag'))
  }
  if (show.folder) {
    const byFolder = {}
    for (const n of graphData.nodes) {
      if (!n.folder_id) continue
      ;(byFolder[n.folder_id] ??= []).push(n.id)
    }
    Object.values(byFolder).forEach((ids) => addGroup(ids, 'folder'))
  }
  return edges
}

export default function GraphView() {
  const navigate = useNavigate()
  const svgRef = useRef(null)
  const { activeNoteId } = useStore()
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState({ strong: true, tag: true, folder: true })
  const simulationRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setGraphData(await fetchGraphData())
    } catch (e) {
      console.error('Graph load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const edges = useMemo(() => (graphData ? buildEdges(graphData, show) : []), [graphData, show])
  const counts = useMemo(() => {
    const c = { strong: 0, tag: 0, folder: 0 }
    for (const e of edges) c[e.kind]++
    return c
  }, [edges])

  useEffect(() => {
    if (!graphData || !svgRef.current) return

    const container = svgRef.current.parentElement
    const width = container.clientWidth
    const height = container.clientHeight

    d3.select(svgRef.current).selectAll('*').remove()
    if (simulationRef.current) simulationRef.current.stop()

    const svg = d3.select(svgRef.current).attr('width', width).attr('height', height)
    const g = svg.append('g')
    svg.call(d3.zoom().scaleExtent([0.15, 4]).on('zoom', (event) => g.attr('transform', event.transform)))

    svg.append('defs').append('marker')
      .attr('id', 'arrow').attr('viewBox', '0 -5 10 10')
      .attr('refX', 18).attr('refY', 0).attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', EDGE.strong.color)

    const nodes = graphData.nodes.map((n) => ({ ...n }))
    const links = edges.map((e) => ({ ...e }))

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id)
        .distance((d) => EDGE[d.kind].distance)
        .strength((d) => EDGE[d.kind].strength))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(22))
    simulationRef.current = simulation

    const link = g.append('g').selectAll('line')
      .data(links).join('line')
      .attr('stroke', (d) => EDGE[d.kind].color)
      .attr('stroke-width', (d) => EDGE[d.kind].width)
      .attr('stroke-opacity', (d) => (d.kind === 'strong' ? 0.9 : 0.35))
      .attr('stroke-dasharray', (d) => EDGE[d.kind].dash)
      .attr('marker-end', (d) => (d.kind === 'strong' ? 'url(#arrow)' : null))

    const node = g.append('g').selectAll('g')
      .data(nodes).join('g')
      .attr('cursor', 'pointer')
      .on('click', (event, d) => { event.stopPropagation(); navigate(`/note/${d.id}`) })
      .call(d3.drag()
        .on('start', (event, d) => { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
        .on('end', (event, d) => { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null }))

    node.append('circle')
      .attr('r', (d) => (d.id === activeNoteId ? 10 : 7))
      .attr('fill', (d) => (d.id === activeNoteId ? '#6366f1' : '#1e293b'))
      .attr('stroke', (d) => (d.id === activeNoteId ? '#818cf8' : '#475569'))
      .attr('stroke-width', 2)

    node.append('text')
      .attr('x', 12).attr('y', '0.35em')
      .attr('fill', '#94a3b8').attr('font-size', '11px')
      .text((d) => d.label?.slice(0, 24))

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y)
      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => simulation.stop()
  }, [graphData, edges, activeNoteId, navigate])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-2 shrink-0 flex-wrap">
        <span className="text-sm font-semibold text-white">Graph</span>
        <div className="flex items-center gap-1.5">
          <LegendToggle label="Links" color={EDGE.strong.color} dashed={false} on={show.strong} onClick={() => setShow((s) => ({ ...s, strong: !s.strong }))} />
          <LegendToggle label="Tags" color={EDGE.tag.color} dashed on={show.tag} onClick={() => setShow((s) => ({ ...s, tag: !s.tag }))} />
          <LegendToggle label="Folders" color={EDGE.folder.color} dashed on={show.folder} onClick={() => setShow((s) => ({ ...s, folder: !s.folder }))} />
        </div>
        <button onClick={load} className="ml-auto p-1 rounded hover:bg-surface-2 text-ink-faint hover:text-ink" title="Refresh">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="flex-1 relative overflow-hidden bg-surface-0">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center"><Loader2 size={20} className="animate-spin text-accent" /></div>
        ) : graphData?.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">No notes yet</div>
        ) : (
          <svg ref={svgRef} className="w-full h-full" />
        )}
      </div>

      {graphData && (
        <div className="px-4 py-2 border-t border-surface-2 text-xs text-ink-faint">
          {graphData.nodes.length} notes · {counts.strong} links · {counts.tag} tag · {counts.folder} folder
        </div>
      )}
    </div>
  )
}

function LegendToggle({ label, color, dashed, on, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${on ? 'bg-surface-2 text-ink' : 'text-ink-faint hover:text-ink-muted'}`}
      title={`Toggle ${label} connections`}
    >
      <span className="inline-block w-4 h-0" style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${on ? color : '#475569'}` }} />
      {label}
    </button>
  )
}
