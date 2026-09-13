import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Background, BackgroundVariant, Controls, MarkerType, ReactFlow, ViewportPortal, applyNodeChanges,
  type Connection, type Edge, type FinalConnectionState, type Node, type NodeChange, type NodeMouseHandler, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Columns3, Gamepad2, Link2, Magnet, Plus, Redo2, Undo2 } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { insightsApi } from '@/api/insights'
import { useResolvedTheme } from '@/hooks/useTheme'
import { useGraphEdits } from '@/hooks/useGraphEdits'
import { useUndoStore } from '@/store/useUndoStore'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import { NewEntityDialog } from '@/components/NewEntityDialog/NewEntityDialog'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import { ResearchNode, type ResearchNodeData } from '@/components/ResearchNode/ResearchNode'
import { useUiStore } from '@/store/useUiStore'
import { toast } from '@/store/useToastStore'
import { fmtNum } from '@/utils/format'
import type { Graph, GraphNode } from '@/types/api'
import styles from './ResearchGraphView.module.css'

const FIELDS = ['Combat', 'Defense', 'NonCombat', 'Fleet', 'Diplomacy', 'Artifact']
const COL = 220
const ROW = 104
const NODE_W = 180
const TIER_COL = 250
const MAX_TIER = 8
type LayoutMode = 'tier' | 'game'
export const tierColor = (t: number | null | undefined) => `var(--tier-${Math.min(MAX_TIER, Math.max(0, t ?? 0))})`
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
  const [layout, setLayout] = useState<LayoutMode>(() => (localStorage.getItem('sotp-research-layout') as LayoutMode) || 'tier')
  useEffect(() => { try { localStorage.setItem('sotp-research-layout', layout) } catch { /* private mode */ } }, [layout])
  const theme = useResolvedTheme()
  const openEntity = useUiStore((s) => s.openEntity)
  const { connect, disconnect, placeResearch, setTier } = useGraphEdits()
  const undoStore = useUndoStore()
  const [portDrop, setPortDrop] = useState<{ x: number; y: number; from: string } | null>(null)
  const [wire, setWire] = useState<{ from: string; mode: 'new' | 'pick' } | null>(null)

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
    const pos = layout === 'tier' ? tierPositions(visible, graph?.edges ?? []) : null
    const nodes: Node<ResearchNodeData>[] = visible.map((n) => ({
      id: n.id, type: 'research',
      position: pos?.get(n.id) ?? { x: (n.x ?? 0) * COL + (n.block ?? 0) * 20, y: (n.y ?? 0) * ROW },
      data: { node: n, unlocks: unlocks.get(n.id)?.length ?? 0, selected: selected === n.id },
    }))
    const edges: Edge[] = (graph?.edges ?? [])
      .filter((e) => e.kind === 'prerequisite' && e.target && ids.has(e.target))
      .map((e, i) => {
        const broken = !!e.dangling || !ids.has(e.source)
        const color = broken ? 'var(--error)' : tierColor(byId.get(e.source)?.tier)   // link wears its source tier's colour
        return {
          id: `${e.source}->${e.target}-${i}`, source: e.source, target: e.target!, type: 'smoothstep',
          pathOptions: { borderRadius: 14 }, data: { source: e.source, target: e.target!, path: e.path, level: e.level ?? null },
          animated: !!e.dangling, label: e.level && e.level > 1 ? `L${e.level}` : undefined,
          style: { stroke: color, strokeWidth: 1.6, opacity: broken ? 1 : 0.75 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        }
      })
    return { nodes, edges, fieldCounts: counts }
  }, [graph, field, unlocks, selected, layout, byId])

  // column bands. tier mode: one column per tier. game mode: the research screen's own columns, labelled by majority tier.
  const bands = useMemo(() => {
    if (layout === 'tier') {
      const tiers = new Map<number, number>()
      for (const n of laidOut) tiers.set(n.data.node.tier ?? 0, (tiers.get(n.data.node.tier ?? 0) ?? 0) + 1)
      const maxTier = Math.max(0, ...tiers.keys())
      const rows = Math.max(1, ...[...tiers.values()])
      return Array.from({ length: maxTier + 1 }, (_, t) => ({ c: t, tier: t, rows, width: TIER_COL, count: tiers.get(t) ?? 0 }))
    }
    const cols = new Map<number, { rows: number; tiers: Map<number, number> }>()
    for (const n of laidOut) {
      const c = n.data.node.x ?? 0
      const entry = cols.get(c) ?? { rows: 0, tiers: new Map() }
      entry.rows = Math.max(entry.rows, (n.data.node.y ?? 0) + 1)
      if (n.data.node.tier != null) entry.tiers.set(n.data.node.tier, (entry.tiers.get(n.data.node.tier) ?? 0) + 1)
      cols.set(c, entry)
    }
    const maxRows = Math.max(1, ...[...cols.values()].map((c) => c.rows))
    const maxCol = Math.max(0, ...cols.keys())
    return Array.from({ length: maxCol + 1 }, (_, c) => {
      const tiers = cols.get(c)?.tiers
      const tier = tiers && tiers.size ? [...tiers.entries()].sort((a, b) => b[1] - a[1])[0][0] : null
      return { c, tier, rows: maxRows, width: COL, count: [...(tiers?.values() ?? [])].reduce((a, b) => a + b, 0) }
    })
  }, [laidOut, layout])

  // local copy so nodes follow the pointer; the server position wins again once the edit lands
  const [nodes, setNodes] = useState<Node<ResearchNodeData>[]>([])
  useEffect(() => { setNodes(laidOut) }, [laidOut])
  const onNodesChange = useCallback((changes: NodeChange<Node<ResearchNodeData>>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), [])
  const onNodeDragStop: OnNodeDrag<Node<ResearchNodeData>> = (_e, n) => {
    const node = byId.get(n.id)
    if (!node) return
    if (layout === 'tier') {   // horizontal drop = new tier; vertical order is cosmetic
      const tier = Math.max(0, Math.min(MAX_TIER, Math.round(n.position.x / TIER_COL)))
      if (tier !== (node.tier ?? 0)) setTier(n.id, tier, node.tier ?? 0)
      else setNodes(laidOut)
      return
    }
    const block = node.block ?? 0
    const x = Math.max(0, Math.round((n.position.x - block * 20) / COL))
    const y = Math.max(0, Math.round(n.position.y / ROW))
    if (x === node.x && y === node.y) { setNodes(laidOut); return }
    const clash = laidOut.find((o) => o.id !== n.id && o.data.node.block === block && o.data.node.x === x && o.data.node.y === y)
    if (clash) toast.error(`Slot [${x}, ${y}] is already used by ${clash.id}; the game will overlap them`)
    placeResearch(n.id, x, y, { x: node.x ?? 0, y: node.y ?? 0 })
  }
  // an edge runs prerequisite -> dependant, so connecting means "target now requires source"
  const onConnect = (c: Connection) => { if (c.source && c.target && c.source !== c.target) connect(c.target, 'prerequisite', c.source, null) }
  const onConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode || state.fromHandle?.type !== 'source') return
    const p = 'changedTouches' in event ? event.changedTouches[0] : event
    setPortDrop({ x: p.clientX, y: p.clientY, from: state.fromNode.id })
  }
  const onEdgesDelete = (deleted: Edge[]) => {
    for (const e of deleted) {
      const d = e.data as { source: string; target: string; path?: string; level?: number | null } | undefined
      if (d?.path) disconnect(d.target, d.path, { target: d.source, level: d.level ?? 1 })
    }
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
        <div className={styles.fields}>
          <button type="button" data-active={layout === 'tier' || undefined} onClick={() => setLayout('tier')} title="One column per tier; drag a node sideways to change its Tier"><Columns3 size={13} /> by tier</button>
          <button type="button" data-active={layout === 'game' || undefined} onClick={() => setLayout('game')} title="Exactly where the game's research screen puts it; drag to move the slot"><Gamepad2 size={13} /> game layout</button>
        </div>
        {layout === 'game' && <button type="button" className={styles.toggle} data-active={snap || undefined} onClick={() => setSnap((v) => !v)} title="Snap dragged nodes to the game's slot grid"><Magnet size={13} /> snap</button>}
        <button type="button" className={styles.toggle} disabled={!undoStore.past.length || undoStore.busy} onClick={() => undoStore.undo()}
                title={undoStore.past.length ? `Undo: ${undoStore.past[undoStore.past.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'}><Undo2 size={13} /></button>
        <button type="button" className={styles.toggle} disabled={!undoStore.future.length || undoStore.busy} onClick={() => undoStore.redo()}
                title={undoStore.future.length ? `Redo: ${undoStore.future[0].label} (Ctrl+Y)` : 'Nothing to redo'}><Redo2 size={13} /></button>
        <span className={styles.help}>{layout === 'tier' ? 'drag sideways to change tier' : 'drag a node to move its slot'} · drag port to port to add a prerequisite · select a line and press Delete to remove it</span>
      </div>
      <div className={styles.canvasRow}>
        <div className={styles.canvas}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={onNodeClick} fitView minZoom={0.2} maxZoom={1.6}
                     onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop} onConnect={onConnect} onConnectEnd={onConnectEnd} onEdgesDelete={onEdgesDelete}
                     onNodeDoubleClick={(_, n) => openEntity(n.id)} snapToGrid={layout === 'game' && snap} snapGrid={[COL, ROW]} connectionRadius={30}
                     deleteKeyCode={['Delete', 'Backspace']} proOptions={{ hideAttribution: true }} colorMode={theme}>
            <Background id="minor" variant={BackgroundVariant.Lines} gap={16} color="var(--grid-minor)" />
            <Background id="major" variant={BackgroundVariant.Lines} gap={128} color="var(--grid-major)" />
            <ViewportPortal>
              {bands.map((b) => (
                <div key={b.c} className={styles.band} data-empty={b.count === 0 || undefined}
                     style={{ transform: `translate(${b.c * b.width - (b.width - NODE_W) / 2}px, -44px)`, width: b.width, height: b.rows * ROW + 60,
                              '--band': tierColor(b.tier) } as React.CSSProperties}>
                  <span className={styles.bandLabel}>{b.tier != null ? `Tier ${b.tier}` : `Column ${b.c + 1}`}<span className={styles.bandCount}>{b.count}</span></span>
                </div>
              ))}
            </ViewportPortal>
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
        {portDrop && (
          <ContextMenu x={portDrop.x} y={portDrop.y} title={`${portDrop.from} → …`} onClose={() => setPortDrop(null)}
                       items={[
                         { label: 'New research subject requiring this…', icon: <Plus size={13} />, onClick: () => setWire({ from: portDrop.from, mode: 'new' }) },
                         { label: 'Make an existing subject require this…', icon: <Link2 size={13} />, onClick: () => setWire({ from: portDrop.from, mode: 'pick' }) },
                       ]} />
        )}
        {wire?.mode === 'new' && (
          <NewEntityDialog initialType="ResearchSubject" onClose={() => setWire(null)}
                           onCreated={(name) => { connect(name, 'prerequisite', wire.from, null); setSelected(name) }} />
        )}
        {wire?.mode === 'pick' && (
          <AssetPicker kind="entity" value="" fieldKey="Subject" onClose={() => setWire(null)}
                       onPick={(v) => { if (v !== wire.from) connect(v, 'prerequisite', wire.from, null) }} />
        )}
      </div>
    </div>
  )
}

/**
 * Column = tier. Rows: prerequisite depth first (so chains read top-to-bottom within a tier), then the
 * mean row of the node's prerequisites (keeps lines short), then name.
 */
function tierPositions(nodes: GraphNode[], edges: Graph['edges']): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id))
  const prereqs = new Map<string, string[]>()
  for (const e of edges) if (e.kind === 'prerequisite' && e.target && ids.has(e.target) && ids.has(e.source)) prereqs.set(e.target, [...(prereqs.get(e.target) ?? []), e.source])
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const dfs = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!
    if (visiting.has(id)) return 0
    visiting.add(id)
    const d = Math.max(0, ...(prereqs.get(id) ?? []).map((p) => dfs(p) + 1))
    visiting.delete(id)
    depth.set(id, d)
    return d
  }
  nodes.forEach((n) => dfs(n.id))
  const byTier = new Map<number, GraphNode[]>()
  for (const n of nodes) byTier.set(n.tier ?? 0, [...(byTier.get(n.tier ?? 0) ?? []), n])
  const row = new Map<string, number>()
  const out = new Map<string, { x: number; y: number }>()
  for (const t of [...byTier.keys()].sort((a, b) => a - b)) {
    const list = byTier.get(t)!
    const bary = (n: GraphNode) => {
      const rows = (prereqs.get(n.id) ?? []).map((p) => row.get(p)).filter((r): r is number => r !== undefined)
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Number.POSITIVE_INFINITY
    }
    list.sort((a, b) => depth.get(a.id)! - depth.get(b.id)! || bary(a) - bary(b) || a.label.localeCompare(b.label))
    list.forEach((n, i) => { row.set(n.id, i); out.set(n.id, { x: t * TIER_COL, y: i * ROW }) })
  }
  return out
}
