import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type Node, type NodeChange, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronRight, Crosshair, FilePlus2, Home, LayoutGrid, Maximize2, Plus, RotateCcw, X } from 'lucide-react'
import { insightsApi } from '@/api/insights'
import { useResolvedTheme } from '@/hooks/useTheme'
import { useGraphEdits } from '@/hooks/useGraphEdits'
import { layoutKey, useGraphStore } from '@/store/useGraphStore'
import { useUiStore } from '@/store/useUiStore'
import { toast } from '@/store/useToastStore'
import { layoutGraph, type LayoutMode, type Positions } from '@/utils/graphLayout'
import { EntityGraphNode, type EntityGraphNodeData } from '@/components/EntityGraphNode/EntityGraphNode'
import { ProxyGraphNode, type ProxyGraphNodeData } from '@/components/ProxyGraphNode/ProxyGraphNode'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import { NewEntityDialog } from '@/components/NewEntityDialog/NewEntityDialog'
import { RelationshipDetail } from '@/components/RelationshipDetail/RelationshipDetail'
import type { RelEdge, RelGraph, RelNode } from '@/types/api'
import styles from './RelationshipView.module.css'

const PATHWAYS: { id: string; label: string }[] = [
  { id: 'ship', label: 'Ships' }, { id: 'research', label: 'Research' }, { id: 'ability', label: 'Abilities' },
  { id: 'buff', label: 'Buffs' }, { id: 'squad', label: 'Squads' }, { id: 'module', label: 'Modules' },
  { id: 'planet', label: 'Planets' }, { id: 'player', label: 'Players' },
]
const ASSET_KINDS = ['mesh', 'particle', 'sound', 'brush', 'texture']
const FACTIONS = ['UNSC', 'Cole', 'Hood', 'Stanforth', 'Covenant', 'Regret', 'Thel']
const EDGE_COLORS: Record<string, string> = {
  Subject: 'var(--warning)', ability: 'var(--covenant)', buffType: 'var(--success)', buffTypeToRemove: 'var(--success)',
  entityDefName: 'var(--text-muted)', squadTypeEntityDef: 'var(--unsc)', fighterEntityDef: 'var(--unsc)', flagship: 'var(--accent)',
}
const nodeTypes = { entity: EntityGraphNode, proxy: ProxyGraphNode }
type RFNode = Node<EntityGraphNodeData> | Node<ProxyGraphNodeData>

const nodeHeight = (n: RelNode) => (n.proxy ? 30 : 58 + 17 * (n.ports.length + 1))
const nodeWidth = (n: RelNode) => (n.proxy ? 190 : 230)

export function RelationshipView() {
  return <ReactFlowProvider><Builder /></ReactFlowProvider>
}

/** Global relationship map: pathways (category filters) or a single entity's pipeline; edges are live fields. */
function Builder() {
  const g = useGraphStore()
  const qc = useQueryClient()
  const openEntity = useUiStore((s) => s.openEntity)
  const { connect, disconnect } = useGraphEdits()
  const rf = useReactFlow()
  const theme = useResolvedTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [picking, setPicking] = useState<null | 'focus' | 'add'>(null)
  const [creating, setCreating] = useState(false)
  const key = layoutKey(g)
  const scene = g.focus ? g.focusInclude : g.include   // nodes brought in by hand for this pathway / focus
  const mode: LayoutMode = g.layoutMode === 'auto' ? (g.focus ? 'compact' : 'pipeline') : g.layoutMode

  const params = {
    categories: g.focus ? undefined : g.categories.join(','), focus: g.focus ?? undefined, depth: g.depth,
    direction: g.direction, incoming: g.incoming || undefined, include: scene.join(',') || undefined,
    factions: !g.focus && g.faction ? g.faction : undefined, asset_kinds: g.assetKinds.join(',') || undefined,
  }
  const { data: graph, isFetching } = useQuery({ queryKey: ['graph', 'relationships', params], queryFn: () => insightsApi.relationships(params), placeholderData: (p) => p })
  const { data: saved } = useQuery({ queryKey: ['graph', 'layout', key], queryFn: () => insightsApi.getLayout(key) })
  const saveLayout = useMutation({ mutationFn: (pos: Positions) => insightsApi.saveLayout(key, pos) })
  const resetLayout = useMutation({
    mutationFn: () => insightsApi.clearLayout(key),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['graph', 'layout', key] }); setDragged({}); toast.info('Layout recomputed') },
  })

  // positions: saved on the server > dragged this session > dagre
  const [dragged, setDragged] = useState<Positions>({})
  const auto = useMemo(() => graph ? layoutGraph(graph.nodes.map((n) => ({
    id: n.id, width: nodeWidth(n), height: nodeHeight(n), category: n.asset ? n.kind : n.category, faction: n.faction, proxy: n.proxy, asset: n.asset,
  })), graph.edges, mode) : {}, [graph, mode])
  const inDegree = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of graph?.edges ?? []) m.set(e.target, (m.get(e.target) ?? 0) + 1)
    return m
  }, [graph])
  const [nodes, setNodes] = useState<RFNode[]>([])
  useEffect(() => {
    if (!graph) return
    setNodes(graph.nodes.map((n) => {
      const position = dragged[n.id] ?? saved?.positions[n.id] ?? auto[n.id] ?? { x: 0, y: 0 }
      const size = { width: nodeWidth(n), height: nodeHeight(n) }   // known up front so fitView works before measurement
      return n.proxy
        ? { id: n.id, type: 'proxy', position, ...size, data: { node: n, selected: selected === n.id, inCount: inDegree.get(n.id) ?? 0 }, draggable: true }
        : { id: n.id, type: 'entity', position, ...size, data: { node: n, selected: selected === n.id, focus: g.focus === n.id } }
    }) as RFNode[])
  }, [graph, saved, auto, dragged, selected, g.focus, inDegree])

  // a new shape (different filter / focus / auto layout) re-fits; drags and selection do not
  const shapeKey = `${key}|${mode}|${graph?.nodes.length ?? 0}|${saved?.updatedAt ?? ''}`
  useEffect(() => { const t = window.setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 60); return () => window.clearTimeout(t) }, [shapeKey, rf])

  // emphasis: links touching the hovered / selected node light up, the rest fade (or hide when decluttering)
  const lit = hover ?? selected
  const edges: Edge[] = useMemo(() => (graph?.edges ?? []).map((e) => {
    const asset = e.kind !== 'entity'
    const color = !e.resolved ? 'var(--error)' : asset ? 'var(--text-muted)' : EDGE_COLORS[e.key] ?? 'var(--border-strong)'
    const touches = lit !== null && (e.source === lit || e.target === lit)
    const state = lit === null ? (g.declutter ? 'faint' : '') : touches ? 'lit' : g.declutter ? 'hidden' : 'dim'
    return {
      id: `${e.source}|${e.path}|${e.target}`, source: e.source, sourceHandle: e.path, target: e.target, targetHandle: 'in',
      type: 'default', animated: !e.resolved && state !== 'hidden', data: e as unknown as Record<string, unknown>, className: state,
      style: { stroke: color, strokeWidth: state === 'lit' ? 2.4 : 1.4, strokeDasharray: asset ? '3 3' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
      zIndex: state === 'lit' ? 10 : 0,
    }
  }), [graph, lit, g.declutter])

  const onNodesChange = useCallback((changes: NodeChange<RFNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), [])
  const pending = useRef<Positions>({})
  const onNodeDragStop: OnNodeDrag<RFNode> = (_e, node, all) => {
    const moved = Object.fromEntries((all.length ? all : [node]).map((n) => [n.id, n.position]))
    setDragged((d) => ({ ...d, ...moved }))
    pending.current = { ...pending.current, ...moved }
    window.setTimeout(() => { const p = pending.current; pending.current = {}; if (Object.keys(p).length) saveLayout.mutate(p) }, 600)
  }

  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])
  const onConnect = (c: Connection) => {
    const target = c.target ? nodeById.get(c.target) : undefined
    if (!c.source || !c.sourceHandle || !target || target.asset) return
    if (c.sourceHandle === 'prerequisite' && target.category !== 'research') { toast.error('Prerequisites must point at a research subject'); return }
    connect(c.source, c.sourceHandle, target.id)
  }
  const onEdgesDelete = (deleted: Edge[]) => {
    for (const e of deleted) {
      const d = e.data as unknown as RelEdge | undefined
      if (d && d.kind === 'entity') disconnect(d.source, d.path)
    }
  }
  const onNodeClick = (_: unknown, n: RFNode) => {
    const rel = nodeById.get(n.id)
    if (rel?.proxy && rel.exists && !rel.asset) g.expand(n.id)
    setSelected(n.id)
  }

  // a selection that is not in the graph is dropped - but not while a refetch (e.g. after Add existing) is still on its way
  useEffect(() => { if (selected && graph && !isFetching && !nodeById.has(selected)) setSelected(null) }, [graph, selected, nodeById, isFetching])
  // a focused entity that was deleted (or renamed) falls back to the pathway view instead of an empty canvas
  useEffect(() => {
    if (graph && g.focus && graph.focus === g.focus && !nodeById.get(g.focus)?.exists) { toast.info(`${g.focus} no longer exists; back to pathways`); g.setFocus(null) }
  }, [graph, g, nodeById])
  const sel = selected ? nodeById.get(selected) : undefined

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.chips}>
          {PATHWAYS.map((p) => (
            <button key={p.id} type="button" className={styles.chip} data-active={(!g.focus && g.categories.includes(p.id)) || undefined}
                    disabled={!!g.focus} onClick={() => g.toggleCategory(p.id)}>{p.label}</button>
          ))}
        </div>
        <select value={g.faction} disabled={!!g.focus} onChange={(e) => g.setFaction(e.target.value)} title="Limit the pathway to one race or faction" className={styles.layoutSel}>
          <option value="">all factions</option>
          {FACTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <span className={styles.sep} />
        <div className={styles.focus}>
          <button type="button" className={styles.homeBtn} data-active={!g.focus || undefined} disabled={!g.focus}
                  onClick={() => g.setFocus(null)} title={g.focus ? 'Leave the focus and show the pathway filters again' : 'Showing the pathway filters'}>
            <Home size={13} /> Pathways
          </button>
          {g.focus ? (
            <>
              <ChevronRight size={12} className={styles.crumbSep} />
              <Crosshair size={13} />
              <button type="button" className={styles.focusName} onClick={() => setPicking('focus')} title="Change the focused entity">{g.focus}</button>
              <select value={g.direction} onChange={(e) => g.setDirection(e.target.value as 'out' | 'in' | 'both')} title="Follow references">
                <option value="out">downstream</option><option value="in">upstream</option><option value="both">both</option>
              </select>
              <select value={g.depth} onChange={(e) => g.setDepth(Number(e.target.value))} title="How many hops">
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} hop{d > 1 ? 's' : ''}</option>)}
              </select>
              <button type="button" className={styles.clearBtn} onClick={() => g.setFocus(null)} title="Clear the focus and go back to the pathway filters"><X size={12} /> Clear focus</button>
            </>
          ) : (
            <button type="button" className={styles.focusBtn} onClick={() => setPicking('focus')}><Crosshair size={12} /> Focus one entity…</button>
          )}
        </div>
        <span className={styles.sep} />
        <label className={styles.check} title="Also show entities that point at the visible ones"><input type="checkbox" checked={g.incoming} onChange={(e) => g.setIncoming(e.target.checked)} /> incoming</label>
        <label className={styles.check} title="Only draw links touching the hovered or selected node"><input type="checkbox" checked={g.declutter} onChange={(e) => g.setDeclutter(e.target.checked)} /> declutter</label>
        <select value={g.layoutMode} onChange={(e) => g.setLayoutMode(e.target.value as LayoutMode | 'auto')} title="Automatic layout style" className={styles.layoutSel}>
          <option value="auto">layout: auto</option><option value="pipeline">pipeline columns</option><option value="compact">compact tree</option>
        </select>
        <div className={styles.assets}>
          {ASSET_KINDS.map((k) => <button key={k} type="button" className={styles.chipSm} data-active={g.assetKinds.includes(k) || undefined} onClick={() => g.toggleAssetKind(k)}>{k}</button>)}
        </div>
        <span className={styles.spacer} />
        <span className={styles.count}>{graph ? `${graph.nodes.length} nodes · ${graph.edges.length} links${graph.truncated ? ' · truncated' : ''}${isFetching ? ' …' : ''}` : ''}</span>
        <button type="button" className={styles.iconBtn} onClick={() => resetLayout.mutate()} title="Auto layout (forget dragged positions)"><LayoutGrid size={14} /></button>
        <button type="button" className={styles.iconBtn} onClick={() => rf.fitView({ padding: 0.15, duration: 300 })} title="Fit to view"><Maximize2 size={14} /></button>
        <button type="button" className={styles.iconBtn} onClick={() => { g.resetView(); setSelected(null); toast.info('View reset: Ships pathway, all factions') }}
                title="Reset the view: clear the focus, faction, asset and extra-node filters"><RotateCcw size={14} /></button>
        <span className={styles.sep} />
        <button type="button" className="btn sm" onClick={() => setPicking('add')} title="Bring an existing entity into this scene as a full node"><FilePlus2 size={12} /> Add existing</button>
        <button type="button" className="btn sm" onClick={() => setCreating(true)}><Plus size={12} /> New entity</button>
      </div>

      <div className={styles.canvasRow}>
        <div className={styles.canvas}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStop={onNodeDragStop}
                     onConnect={onConnect} onEdgesDelete={onEdgesDelete} onNodeClick={onNodeClick} onPaneClick={() => setSelected(null)}
                     onNodeMouseEnter={(_, n) => setHover(n.id)} onNodeMouseLeave={() => setHover(null)}
                     onNodeDoubleClick={(_, n) => { const r = nodeById.get(n.id); if (r && r.exists && !r.asset) openEntity(n.id) }}
                     fitView minZoom={0.1} maxZoom={1.8} deleteKeyCode={['Delete', 'Backspace']} nodesConnectable
                     connectionRadius={28} proOptions={{ hideAttribution: true }} colorMode={theme}>
            <Background id="minor" variant={BackgroundVariant.Lines} gap={16} color="var(--grid-minor)" />
            <Background id="major" variant={BackgroundVariant.Lines} gap={128} color="var(--grid-major)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeClassName={(n) => (n.type === 'proxy' ? '' : 'is-entity')} />
          </ReactFlow>
          {graph && graph.nodes.length === 0 && (
            <div className={styles.empty}>
              <p>Nothing to show{g.focus ? ` for ${g.focus}` : ''}.</p>
              <div className={styles.emptyActions}>
                {g.focus && <button type="button" className="btn sm" onClick={() => g.setFocus(null)}><Home size={12} /> Back to pathways</button>}
                {!g.focus && !g.categories.length && <button type="button" className="btn sm" onClick={() => g.setCategories(['ship'])}>Show Ships</button>}
                <button type="button" className="btn sm" onClick={() => setPicking('add')}><FilePlus2 size={12} /> Add existing entity</button>
                <button type="button" className="btn sm" onClick={() => g.resetView()}><RotateCcw size={12} /> Reset view</button>
              </div>
            </div>
          )}
        </div>
        {sel && (
          <RelationshipDetail node={sel} edges={graph?.edges ?? []} onSelect={(id) => { const r = nodeById.get(id); if (r?.proxy) g.expand(id); setSelected(id) }}
                              onFocus={(id) => { g.setFocus(id); setSelected(id) }} onClose={() => setSelected(null)} onDisconnect={disconnect}
                              added={scene.includes(sel.id)} onRemoveFromScene={() => { g.exclude(sel.id); setSelected(null) }} />
        )}
      </div>

      {picking === 'focus' && <AssetPicker kind="entity" value={g.focus ?? ''} onPick={(v) => { g.setFocus(v); setSelected(v) }} onClose={() => setPicking(null)} />}
      {picking === 'add' && (
        <AssetPicker kind="entity" value="" onClose={() => setPicking(null)}
                     onPick={(v) => { if (nodeById.get(v) && !nodeById.get(v)?.proxy) toast.info(`${v} is already in the scene`); else { g.expand(v); toast.success(`Added ${v} to the scene`) } setSelected(v) }} />
      )}
      {creating && <NewEntityDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

export type { RelGraph }
