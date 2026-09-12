import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Background, BackgroundVariant, Controls, MarkerType, ReactFlow, applyNodeChanges,
  type Connection, type Edge, type Node, type NodeChange, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Magnet } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { insightsApi } from '@/api/insights'
import { useResolvedTheme } from '@/hooks/useTheme'
import { useGraphEdits } from '@/hooks/useGraphEdits'
import { ResearchNode, type ResearchNodeData } from '@/components/ResearchNode/ResearchNode'
import { useUiStore } from '@/store/useUiStore'
import { toast } from '@/store/useToastStore'
import { fmtNum } from '@/utils/format'
import type { GraphNode } from '@/types/api'
import styles from './ResearchGraphView.module.css'

const FIELDS = ['Combat', 'Defense', 'NonCombat', 'Fleet', 'Diplomacy', 'Artifact']
const COL = 210
const ROW = 96
const nodeTypes = { research: ResearchNode }

/**
 * The research screen as the game lays it out (block / pos), with prerequisite edges and unlock lists.
 * Dragging a node rewrites its ``researchWindowLocation.pos``; dragging between ports adds a prerequisite;
 * selecting an edge and pressing Delete removes one.
 */
export function ResearchGraphView() {
  const [player, setPlayer] = useState('')
  const [field, setField] = useState('Combat')
  const [selected, setSelected] = useState<string | null>(null)
  const [snap, setSnap] = useState(true)
  const theme = useResolvedTheme()
  const openEntity = useUiStore((s) => s.openEntity)
  const { connect, disconnect, placeResearch } = useGraphEdits()

  const { data: players = [] } = useQuery({ queryKey: ['entities', 'players'], queryFn: () => entitiesApi.list({ entity_type: 'Player' }), retry: false })
  useEffect(() => { if (!player && players.length) setPlayer(players[0].name) }, [players, player])
  const { data: graph } = useQuery({ queryKey: ['graph', 'research', player], queryFn: () => insightsApi.researchGraph(player), enabled: !!player })

  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])
  const unlocks = useMemo(() => {
    const m = new Map<string, GraphNode[]>()
    for (const e of graph?.edges ?? []) if (e.kind === 'unlocks') m.set(e.source, [...(m.get(e.source) ?? []), byId.get(e.target)!].filter(Boolean))
    return m
  }, [graph, byId])

  const { nodes: laidOut, edges, fieldCounts } = useMemo(() => {
    const counts: Record<string, number> = {}
    const research = (graph?.nodes ?? []).filter((n) => !n.unit)
    for (const n of research) counts[n.field ?? '?'] = (counts[n.field ?? '?'] ?? 0) + 1
    const visible = research.filter((n) => (n.field ?? '?') === field)
    const ids = new Set(visible.map((n) => n.id))
    const nodes: Node<ResearchNodeData>[] = visible.map((n) => ({
      id: n.id, type: 'research',
      position: { x: (n.x ?? 0) * COL + (n.block ?? 0) * 20, y: (n.y ?? 0) * ROW },
      data: { node: n, unlocks: unlocks.get(n.id)?.length ?? 0, selected: selected === n.id },
    }))
    const edges: Edge[] = (graph?.edges ?? [])
      .filter((e) => e.kind === 'prerequisite' && e.target && ids.has(e.target))
      .map((e, i) => ({
        id: `${e.source}->${e.target}-${i}`, source: e.source, target: e.target!, type: 'smoothstep',
        data: { source: e.source, target: e.target!, path: e.path },
        animated: !!e.dangling, label: e.level && e.level > 1 ? `L${e.level}` : undefined,
        style: { stroke: e.dangling || !ids.has(e.source) ? 'var(--error)' : 'var(--border-strong)', strokeWidth: 1.4 },
        markerEnd: { type: MarkerType.ArrowClosed, color: e.dangling ? 'var(--error)' : 'var(--border-strong)' },
      }))
    return { nodes, edges, fieldCounts: counts }
  }, [graph, field, unlocks, selected])

  // local copy so nodes follow the pointer; the server position wins again once the edit lands
  const [nodes, setNodes] = useState<Node<ResearchNodeData>[]>([])
  useEffect(() => { setNodes(laidOut) }, [laidOut])
  const onNodesChange = useCallback((changes: NodeChange<Node<ResearchNodeData>>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), [])
  const onNodeDragStop: OnNodeDrag<Node<ResearchNodeData>> = (_e, n) => {
    const node = byId.get(n.id)
    if (!node) return
    const block = node.block ?? 0
    const x = Math.max(0, Math.round((n.position.x - block * 20) / COL))
    const y = Math.max(0, Math.round(n.position.y / ROW))
    if (x === node.x && y === node.y) { setNodes(laidOut); return }
    const clash = laidOut.find((o) => o.id !== n.id && o.data.node.block === block && o.data.node.x === x && o.data.node.y === y)
    if (clash) toast.error(`Slot [${x}, ${y}] is already used by ${clash.id}; the game will overlap them`)
    placeResearch(n.id, x, y)
  }
  const onConnect = (c: Connection) => { if (c.source && c.target && c.source !== c.target) connect(c.target, 'prerequisite', c.source) }
  const onEdgesDelete = (deleted: Edge[]) => {
    for (const e of deleted) { const d = e.data as { source: string; target: string; path?: string } | undefined; if (d?.path) disconnect(d.target, d.path) }
  }
  const onNodeClick: NodeMouseHandler = (_, n) => setSelected(n.id)
  const sel = selected ? byId.get(selected) : undefined
  const prereqs = (graph?.edges ?? []).filter((e) => e.kind === 'prerequisite' && e.target === selected)

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <select value={player} onChange={(e) => { setPlayer(e.target.value); setSelected(null) }}>
          {players.map((p) => <option key={p.name} value={p.name}>{p.name.replace(/^Player_/, '')}</option>)}
        </select>
        <div className={styles.fields}>
          {FIELDS.map((f) => (
            <button key={f} data-active={field === f || undefined} onClick={() => setField(f)}>{f} <span>{fieldCounts[f] ?? 0}</span></button>
          ))}
        </div>
        <span className="muted">{graph ? `${graph.nodes.filter((n) => !n.unit).length} research · ${graph.edges.filter((e) => e.kind === 'prerequisite').length} prerequisites` : ''}</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.toggle} data-active={snap || undefined} onClick={() => setSnap((v) => !v)} title="Snap dragged nodes to the game's slot grid"><Magnet size={13} /> snap</button>
        <span className={styles.help}>drag a node to move its slot · drag port to port to add a prerequisite · select a line and press Delete to remove it</span>
      </div>
      <div className={styles.canvasRow}>
        <div className={styles.canvas}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} fitView minZoom={0.2} maxZoom={1.6}
                     onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onConnect={onConnect} onEdgesDelete={onEdgesDelete}
                     onNodeDoubleClick={(_, n) => openEntity(n.id)} snapToGrid={snap} snapGrid={[COL, ROW]} connectionRadius={30}
                     deleteKeyCode={['Delete', 'Backspace']} proOptions={{ hideAttribution: true }} colorMode={theme}>
            <Background id="minor" variant={BackgroundVariant.Lines} gap={16} color="var(--grid-minor)" />
            <Background id="major" variant={BackgroundVariant.Lines} gap={128} color="var(--grid-major)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        {sel && (
          <aside className={styles.detail}>
            <h3 className={styles.detailName}>{sel.label}</h3>
            <p className={styles.mono}>{sel.id}</p>
            <dl className={styles.facts}>
              <dt>Tier</dt><dd>{sel.tier}</dd>
              <dt>Slot</dt><dd>block {sel.block} · [{sel.x}, {sel.y}]</dd>
              <dt>Cost</dt><dd>{fmtNum(sel.cost)}</dd>
              <dt>Time</dt><dd>{fmtNum(sel.time)} s</dd>
              <dt>Levels</dt><dd>{sel.levels}</dd>
            </dl>
            <h4 className={styles.sub}>Requires</h4>
            <ul className={styles.links}>
              {prereqs.length ? prereqs.map((e) => <li key={e.source}><button onClick={() => byId.has(e.source) ? setSelected(e.source) : openEntity(e.source)} data-missing={e.dangling || undefined}>{e.source}{e.level && e.level > 1 ? ` (L${e.level})` : ''}</button></li>) : <li className="muted">nothing</li>}
            </ul>
            <h4 className={styles.sub}>Unlocks</h4>
            <ul className={styles.links}>
              {(unlocks.get(sel.id) ?? []).length ? unlocks.get(sel.id)!.map((u) => <li key={u.id}><button onClick={() => openEntity(u.id)}>{u.label} <span className="muted">{u.entityType}</span></button></li>) : <li className="muted">no units</li>}
            </ul>
            <button className="btn sm primary" onClick={() => openEntity(sel.id)}>Open entity</button>
          </aside>
        )}
      </div>
    </div>
  )
}
