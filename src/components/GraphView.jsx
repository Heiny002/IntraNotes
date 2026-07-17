import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, RefreshCw } from 'lucide-react'
import { fetchGraphData } from '../lib/supabase'
import { useStore } from '../lib/store'

// Using d3 for force-directed graph
import * as d3 from 'd3'

export default function GraphView() {
  const navigate = useNavigate()
  const svgRef = useRef(null)
  const { activeNoteId } = useStore()
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(true)
  const simulationRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchGraphData()
      setGraphData(data)
    } catch (e) {
      console.error('Graph load error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!graphData || !svgRef.current) return

    const container = svgRef.current.parentElement
    const width = container.clientWidth
    const height = container.clientHeight

    // Clear previous
    d3.select(svgRef.current).selectAll('*').remove()
    if (simulationRef.current) simulationRef.current.stop()

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)

    // Zoom
    const g = svg.append('g')
    const zoom = d3.zoom().scaleExtent([0.2, 4]).on('zoom', (event) => {
      g.attr('transform', event.transform)
    })
    svg.call(zoom)

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 18)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#475569')

    const nodes = graphData.nodes.map((n) => ({ ...n }))
    const links = graphData.links
      .map((l) => ({ ...l }))
      .filter((l) =>
        nodes.find((n) => n.id === l.source) && nodes.find((n) => n.id === l.target)
      )

    // Simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id((d) => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide(20))

    simulationRef.current = simulation

    // Links
    const link = g.append('g').selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#334155')
      .attr('stroke-width', 1.5)
      .attr('marker-end', 'url(#arrow)')

    // Nodes
    const node = g.append('g').selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation()
        navigate(`/note/${d.id}`)
      })
      .call(
        d3.drag()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )

    node.append('circle')
      .attr('r', (d) => d.id === activeNoteId ? 10 : 7)
      .attr('fill', (d) => d.id === activeNoteId ? '#6366f1' : '#1e293b')
      .attr('stroke', (d) => d.id === activeNoteId ? '#818cf8' : '#475569')
      .attr('stroke-width', 2)

    node.append('text')
      .attr('x', 12)
      .attr('y', '0.35em')
      .attr('fill', '#94a3b8')
      .attr('font-size', '11px')
      .text((d) => d.label?.slice(0, 24))

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y)
      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => simulation.stop()
  }, [graphData, activeNoteId, navigate])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-2 shrink-0">
        <span className="text-sm font-semibold text-white">Graph View</span>
        <button onClick={load} className="ml-auto p-1 rounded hover:bg-surface-2 text-ink-faint hover:text-ink">
          <RefreshCw size={13}/>
        </button>
      </div>
      <div className="flex-1 relative overflow-hidden bg-surface-0">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-accent"/>
          </div>
        ) : graphData?.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">No notes yet</div>
        ) : (
          <svg ref={svgRef} className="w-full h-full"/>
        )}
      </div>
      {graphData && (
        <div className="px-4 py-2 border-t border-surface-2 text-xs text-ink-faint">
          {graphData.nodes.length} notes · {graphData.links.length} links
        </div>
      )}
    </div>
  )
}
