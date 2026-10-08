import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background, BackgroundVariant, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow,
  type Connection, type Edge, type FinalConnectionState, type Node, type NodeChange, type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronRight, Crosshair, FilePlus2, Home, LayoutGrid, Link2, Maximize2, Plus, Redo2, RotateCcw, Undo2, X } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { insightsApi } from '@/api/insights'
import { useResolvedTheme } from '@/hooks/useTheme'
import { useGraphEdits } from '@/hooks/useGraphEdits'
import { useUndoStore } from '@/store/useUndoStore'
import { ContextMenu } from '@/components/ContextMenu/ContextMenu'
import { layoutKey, useGraphStore } from '@/store/useGraphStore'
import { useUiStore } from '@/store/useUiStore'
import { toast } from '@/store/useToastStore'
import { fanLayout, layoutGraph, type FanChip, type LayoutMode, type Positions } from '@/utils/graphLayout'
import { KIND_ORDER, kindRank } from '@/utils/assetKinds'
import { EntityGraphNode, type EntityGraphNodeData } from '@/components/EntityGraphNode/EntityGraphNode'
import { ProxyGraphNode, type ProxyGraphNodeData } from '@/components/ProxyGraphNode/ProxyGraphNode'
import { ASSET_H, ASSET_W, AssetGraphNode, type AssetGraphNodeData } from '@/components/AssetGraphNode/AssetGraphNode'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import { NewEntityDialog } from '@/components/NewEntityDialog/NewEntityDialog'
import { RelationshipDetail } from '@/components/RelationshipDetail/RelationshipDetail'
import { useFactions } from '@/hooks/useFactions'
import type { Reference, RelEdge, RelGraph, RelNode } from '@/types/api'
import styles from './RelationshipView.module.css'

const PATHWAYS: { id: string; label: string }[] = [
  { id: 'ship', label: 'Ships' }, { id: 'research', label: 'Research' }, { id: 'ability', label: 'Abilities' },
  { id: 'buff', label: 'Buffs' }, { id: 'squad', label: 'Squads' }, { id: 'module', label: 'Modules' },
  { id: 'planet', label: 'Planets' }, { id: 'player', label: 'Players' },
]
const ASSET_KINDS = ['mesh', 'particle', 'sound', 'brush', 'texture']
const EDGE_COLORS: Record<string, string> = {
  Subject: 'var(--warning)', ability: 'var(--covenant)', buffType: 'var(--success)', buffTypeToRemove: 'var(--success)',
  entityDefName: 'var(--text-muted)', squadTypeEntityDef: 'var(--unsc)', fighterEntityDef: 'var(--unsc)', flagship: 'var(--accent)',
}
const nodeTypes = { entity: EntityGraphNode, proxy: ProxyGraphNode, asset: AssetGraphNode }
type RFNode = Node<EntityGraphNodeData> | Node<ProxyGraphNodeData> | Node<AssetGraphNodeData>
const FAN_LIMIT = 12   // chips per kind before the rest folds into a "+N more" chip

const nodeHeight = (n: RelNode) => (n.proxy ? 30 : 58 + 17 * ((n.ports ?? []).length + 1) + 18 * Object.keys(n.assetCounts ?? {}).length + 6)
const nodeWidth = (n: RelNode) => (n.proxy ? 190 : 230)
/** Anchor-relative y of the middle of the Assets rows that carry wires - the fan is centred on it. */
function hubOffset(n: RelNode, wired: string[]) {
  const rows = KIND_ORDER.filter((k) => (n.assetCounts?.[k] ?? 0) > 0)
  const top = nodeHeight(n) - (18 * rows.length + 6) + 3
  const ys = rows.map((k, i) => (wired.includes(k) ? top + 18 * i + 11 : null)).filter((y): y is number => y !== null)
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : nodeHeight(n) / 2
}

// chip ids carry the anchor so a shared sound fanned from two ships is two nodes (and two remembered positions)
const chipId = (anchor: string, kind: string, name: string) => `asset:${anchor}:${kind}:${name}`
const isChip = (id: string) => id.startsWith('asset:')
interface Fan {
  chips: FanChip[]                            // in display order: grouped by kind, missing first, fold chip last
  data: Map<string, AssetGraphNodeData>
  links: RelEdge[]                            // one per (kind, asset) - the canvas wires and the anchor's "points at"
  fold: RelEdge[]                             // wires to the "+N more" chips (canvas only)
  fields: RelEdge[]                           // one per referencing field - what a selected chip lists
  total: number
}
const NO_FAN: Fan = { chips: [], data: new Map(), links: [], fold: [], fields: [], total: 0 }

/** The selected entity's asset references as chips: merged per (kind, asset), long kinds folded past FAN_LIMIT. */
function buildFan(anchor: string | null, refs: Reference[] | undefined, kinds: string[], expanded: Set<string>): Fan {
  if (!anchor || !refs || !kinds.length) return NO_FAN
  const merged = new Map<string, { kind: string; name: string; key: string; resolved: boolean; paths: string[] }>()
  const fields: RelEdge[] = []
  for (const r of refs) {
    if (!kinds.includes(r.kind)) continue
    const id = chipId(anchor, r.kind, r.target)
    const m = merged.get(id) ?? { kind: r.kind, name: r.target, key: r.key, resolved: r.resolved, paths: [] }
    m.paths.push(r.path)
    merged.set(id, m)
    fields.push({ source: anchor, target: id, path: r.path, key: r.key, kind: r.kind, resolved: r.resolved })
  }
  const all = [...merged.entries()].sort(([, a], [, b]) => kindRank(a.kind) - kindRank(b.kind) || Number(a.resolved) - Number(b.resolved) || a.name.localeCompare(b.name))
  const fan: Fan = { chips: [], data: new Map(), links: [], fold: [], fields, total: all.length }
  for (const kind of KIND_ORDER) {
    const group = all.filter(([, m]) => m.kind === kind)
    if (!group.length) continue
    const open = expanded.has(kind)
    for (const [id, m] of open ? group : group.slice(0, FAN_LIMIT)) {
      fan.chips.push({ id, kind, width: ASSET_W, height: ASSET_H })
      fan.data.set(id, { name: m.name, kind, exists: m.resolved, count: m.paths.length, selected: false })
      fan.links.push({ source: anchor, target: id, path: m.paths[0], key: m.key, kind, resolved: m.resolved, paths: m.paths, count: m.paths.length })
    }
    if (group.length > FAN_LIMIT) {
      const id = chipId(anchor, kind, '+more')
      fan.chips.push({ id, kind, width: ASSET_W, height: ASSET_H })
      fan.data.set(id, { name: '', kind, exists: true, count: 0, selected: false, more: { hidden: group.length - FAN_LIMIT, expanded: open } })
      fan.fold.push({ source: anchor, target: id, path: '', key: 'more', kind, resolved: true })
    }
  }
  return fan
}

export function RelationshipView() {
  return <ReactFlowProvider><Builder /></ReactFlowProvider>
}

/** Global relationship map: pathways (category filters) or a single entity's pipeline; edges are live fields. */
function Builder() {
  const g = useGraphStore()
  const { options: factionOptions } = useFactions()
  const qc = useQueryClient()
  const openEntity = useUiStore((s) => s.openEntity)
  const { connect, disconnect } = useGraphEdits()
  const rf = useReactFlow()
  const theme = useResolvedTheme()
  const [selected, setSelected] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)          // the entity whose assets are fanned out (sticky until another is picked)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())   // asset kinds unfolded past FAN_LIMIT
  const [hover, setHover] = useState<string | null>(null)
  const [picking, setPicking] = useState<null | 'focus' | 'add'>(null)
  const [creating, setCreating] = useState(false)
  // a port dragged onto empty canvas: offer to create / pick the entity it should point at
  const [portDrop, setPortDrop] = useState<{ x: number; y: number; source: string; port: string } | null>(null)
  const [wire, setWire] = useState<{ source: string; port: string; mode: 'new' | 'pick' } | null>(null)
  const undoStore = useUndoStore()
  const key = layoutKey(g)
  const scene = g.focus ? g.focusInclude : g.include   // nodes brought in by hand for this pathway / focus
  const mode: LayoutMode = g.layoutMode === 'auto' ? (g.focus ? 'compact' : 'pipeline') : g.layoutMode

  const params = {
    categories: g.focus ? undefined : g.categories.join(','), focus: g.focus ?? undefined, depth: g.depth,
    direction: g.direction, incoming: g.incoming || undefined, include: scene.join(',') || undefined,
    factions: !g.focus && g.faction ? g.faction : undefined,
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
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph])

  // Asset wires: one node's meshes / sounds / brushes fan out from its Assets rows as a column of chips beside it.
  // They come from the entity's own references (cached, cheap) rather than the graph query, so picking a node
  // never refetches or re-lays out the pathway.  A whole pathway's assets are never drawn - unreadable and slow.
  const candidate = anchor ?? g.focus
  const fanFrom = g.assetKinds.length && candidate && nodeById.get(candidate) && !nodeById.get(candidate)!.proxy ? candidate : null
  const { data: refs } = useQuery({ queryKey: ['entity', fanFrom, 'references'], queryFn: () => entitiesApi.references(fanFrom!), enabled: !!fanFrom, staleTime: 30_000 })
  const fan = useMemo(() => buildFan(fanFrom, refs, g.assetKinds, expanded), [fanFrom, refs, g.assetKinds, expanded])
  useEffect(() => setExpanded(new Set()), [fanFrom])
  useEffect(() => setAnchor(null), [key])
  /** Select a node; an entity also becomes the fan anchor (chips and proxies leave the anchor where it is). */
  const select = useCallback((id: string | null) => {
    setSelected(id)
    const n = id ? nodeById.get(id) : undefined
    if (n && !n.proxy) setAnchor(id)
  }, [nodeById])

  const [nodes, setNodes] = useState<RFNode[]>([])
  const nodeCache = useRef(new Map<string, RFNode>())
  const shiftRef = useRef(new Map<string, number>())   // how far each entity was pushed right to make room for the fan
  useEffect(() => {
    if (!graph) return
    const base = (id: string) => dragged[id] ?? saved?.positions[id] ?? auto[id] ?? { x: 0, y: 0 }
    // the fan takes a lane right of its anchor; everything already right of the anchor moves over as a block
    const anchorNode = fanFrom ? nodeById.get(fanFrom) : undefined
    const shift = new Map<string, number>()
    let fanPos: Positions = {}
    if (anchorNode && fan.chips.length) {
      const ap = base(anchorNode.id), width = nodeWidth(anchorNode)
      const laid = fanLayout({ x: ap.x, y: ap.y, width, hubY: hubOffset(anchorNode, g.assetKinds) }, fan.chips)
      fanPos = laid.positions
      for (const n of graph.nodes) if (n.id !== anchorNode.id && base(n.id).x >= ap.x + width) shift.set(n.id, laid.laneWidth)
    }
    shiftRef.current = shift
    // node objects are reused when nothing about them changed, so a click re-renders the two nodes it touched, not all of them
    const cache = nodeCache.current, next = new Map<string, RFNode>()
    const entities = graph.nodes.map((n) => {
      const b = base(n.id), position = { x: b.x + (shift.get(n.id) ?? 0), y: b.y }
      const isSel = selected === n.id, isFocus = g.focus === n.id, inCount = inDegree.get(n.id) ?? 0
      const prev = cache.get(n.id)
      const same = prev && prev.data.node === n && prev.position.x === position.x && prev.position.y === position.y && prev.data.selected === isSel
        && (n.proxy ? (prev.data as ProxyGraphNodeData).inCount === inCount : (prev.data as EntityGraphNodeData).focus === isFocus)
      if (same) { next.set(n.id, prev); return prev }
      const size = { width: nodeWidth(n), height: nodeHeight(n) }   // known up front so fitView works before measurement
      const node = (n.proxy
        ? { id: n.id, type: 'proxy', position, ...size, data: { node: n, selected: isSel, inCount }, draggable: true }
        : { id: n.id, type: 'entity', position, ...size, data: { node: n, selected: isSel, focus: isFocus } }) as RFNode
      next.set(n.id, node)
      return node
    })
    // chips can be dragged like any node; a moved chip keeps its spot (and is remembered with the layout), the rest follow the anchor
    const chips = fan.chips.map((c) => ({
      id: c.id, type: 'asset', position: dragged[c.id] ?? saved?.positions[c.id] ?? fanPos[c.id], width: c.width, height: c.height,
      data: { ...fan.data.get(c.id)!, selected: selected === c.id },
    }) as RFNode)
    nodeCache.current = next
    setNodes([...entities, ...chips])
  }, [graph, saved, auto, dragged, selected, g.focus, g.assetKinds, inDegree, nodeById, fanFrom, fan])

  // a new shape (different filter / focus / auto layout) re-fits; drags, selection and asset fan-outs do not
  const shapeKey = `${key}|${mode}|${graph?.nodes.length ?? 0}|${saved?.updatedAt ?? ''}`
  useEffect(() => { const t = window.setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 60); return () => window.clearTimeout(t) }, [shapeKey, rf])

  // emphasis: links touching the hovered / selected node light up, the rest fade (or hide when decluttering).
  // Edge objects are reused when their state did not change, so hovering re-renders a handful of edges, not all of them.
  const lit = hover ?? selected
  const wires = useMemo(() => [...(graph?.edges ?? []), ...fan.links, ...fan.fold], [graph, fan])
  const edgeCache = useRef(new Map<string, Edge>())
  const edges: Edge[] = useMemo(() => {
    const cache = edgeCache.current
    const next = new Map<string, Edge>()
    const out = wires.map((e) => {
      const asset = e.kind !== 'entity', fold = e.key === 'more'
      const touches = lit !== null && (e.source === lit || e.target === lit)
      const state = lit === null ? (g.declutter ? 'faint' : '') : touches ? 'lit' : g.declutter ? 'hidden' : 'dim'
      const id = `${e.source}|${e.path}|${e.target}`
      const prev = cache.get(id)
      if (prev && prev.className === state && prev.data === (e as unknown)) { next.set(id, prev); return prev }
      const color = !e.resolved ? 'var(--error)' : asset ? 'var(--text-muted)' : EDGE_COLORS[e.key] ?? 'var(--border-strong)'
      const edge: Edge = {
        id, source: e.source, sourceHandle: asset ? `assets:${e.kind}` : e.path, target: e.target, targetHandle: 'in',
        type: 'default', animated: !e.resolved && state !== 'hidden', data: e as unknown as Record<string, unknown>, className: state,
        style: { stroke: color, strokeWidth: state === 'lit' ? 2.4 : fold ? 1 : 1.4, strokeDasharray: fold ? '2 5' : asset ? '3 3' : undefined, opacity: fold ? 0.6 : undefined },
        markerEnd: fold ? undefined : { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
        zIndex: state === 'lit' ? 10 : 0,
      }
      next.set(id, edge)
      return edge
    })
    edgeCache.current = next
    return out
  }, [wires, lit, g.declutter])

  const onNodesChange = useCallback((changes: NodeChange<RFNode>[]) => setNodes((ns) => applyNodeChanges(changes, ns)), [])
  const pending = useRef<Positions>({})
  const dragStart = useRef<Positions>({})
  const applyPositions = (pos: Positions) => { setDragged((d) => ({ ...d, ...pos })); saveLayout.mutate(pos) }
  // positions are recorded without the fan's push, so a node dropped while a fan is open stays put when it closes
  const settle = (list: RFNode[]) => Object.fromEntries(list.map((n) => [n.id, { x: n.position.x - (shiftRef.current.get(n.id) ?? 0), y: n.position.y }]))
  const onNodeDragStart: OnNodeDrag<RFNode> = (_e, node, all) => { dragStart.current = settle(all.length ? all : [node]) }
  const onNodeDragStop: OnNodeDrag<RFNode> = (_e, node, all) => {
    const moved = settle(all.length ? all : [node])
    if (!Object.keys(moved).length) return
    const before = dragStart.current
    setDragged((d) => ({ ...d, ...moved }))
    pending.current = { ...pending.current, ...moved }
    window.setTimeout(() => { const p = pending.current; pending.current = {}; if (Object.keys(p).length) saveLayout.mutate(p) }, 600)
    const ids = Object.keys(moved).filter((id) => before[id] && (before[id].x !== moved[id].x || before[id].y !== moved[id].y))
    if (ids.length) {
      const from = Object.fromEntries(ids.map((id) => [id, before[id]])), to = Object.fromEntries(ids.map((id) => [id, moved[id]]))
      undoStore.push({ label: ids.length === 1 ? `move ${ids[0]}` : `move ${ids.length} nodes`, undo: () => applyPositions(from), redo: () => applyPositions(to) })
    }
  }

  /** What a port currently points at (for undo), or '' for a free port. */
  const currentTarget = (source: string, port: string) => (graph?.edges ?? []).find((e) => e.source === source && e.path === port)?.target ?? ''
  const wireUp = (source: string, port: string, target: string) => {
    const t = nodeById.get(target)
    if (port === 'prerequisite' && t && t.category !== 'research') { toast.error('Prerequisites must point at a research subject'); return }
    connect(source, port, target, port === 'prerequisite' ? null : currentTarget(source, port))
  }
  const onConnect = (c: Connection) => {
    const target = c.target ? nodeById.get(c.target) : undefined
    if (!c.source || !c.sourceHandle || !target || target.asset) return
    wireUp(c.source, c.sourceHandle, target.id)
  }
  // a connection dropped on empty canvas: offer to create the missing entity or pick an existing one
  const onConnectEnd = (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    if (state.isValid || !state.fromNode || !state.fromHandle || state.fromHandle.type !== 'source' || !state.fromHandle.id) return
    const p = 'changedTouches' in event ? event.changedTouches[0] : event
    setPortDrop({ x: p.clientX, y: p.clientY, source: state.fromNode.id, port: state.fromHandle.id })
  }
  const onEdgesDelete = (deleted: Edge[]) => {
    for (const e of deleted) {
      const d = e.data as unknown as RelEdge | undefined
      if (d && d.kind === 'entity') disconnect(d.source, d.path, { target: d.target })
    }
  }
  const onNodeClick = (_: unknown, n: RFNode) => {
    if (n.type === 'asset') {
      const d = n.data as AssetGraphNodeData
      if (d.more) setExpanded((s) => { const t = new Set(s); if (t.has(d.kind)) t.delete(d.kind); else t.add(d.kind); return t })
      else select(n.id)
      return
    }
    const rel = nodeById.get(n.id)
    if (rel?.proxy && rel.exists && !rel.asset) g.expand(n.id)
    select(n.id)
  }

  // a selection that is not in the graph is dropped - but not while a refetch (e.g. after Add existing) is still on its way
  useEffect(() => {
    if (selected && graph && !isFetching && !nodeById.has(selected) && !fan.data.has(selected)) setSelected(null)
  }, [graph, selected, nodeById, isFetching, fan])
  // a focused entity that was deleted (or renamed) falls back to the pathway view instead of an empty canvas
  useEffect(() => {
    if (graph && g.focus && graph.focus === g.focus && !nodeById.get(g.focus)?.exists) { toast.info(`${g.focus} no longer exists; back to pathways`); g.setFocus(null) }
  }, [graph, g, nodeById])
  // a selected chip is shown like an asset node; its links are the anchor's fields that reference it
  const sel: RelNode | undefined = selected
    ? (isChip(selected) ? chipAsNode(selected, fan) : nodeById.get(selected))
    : undefined
  const detailEdges = useMemo(() => (sel?.asset ? fan.fields.filter((e) => e.target === sel.id) : graph?.edges ?? []), [sel, graph, fan])

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
          {factionOptions.map((f) => <option key={f} value={f}>{f}</option>)}
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
        <span className={styles.count}>
          {graph ? `${graph.nodes.length} nodes · ${graph.edges.length} links${graph.truncated ? ' · truncated' : ''}${isFetching ? ' …' : ''}` : ''}
          {fanFrom && fan.total > 0 && ` · ${fan.total} asset${fan.total === 1 ? '' : 's'} of ${fanFrom}`}
          {g.assetKinds.length > 0 && !fanFrom && <span className={styles.hintInline}> · select a node to fan out its assets</span>}
        </span>
        <button type="button" className={styles.iconBtn} disabled={!undoStore.past.length || undoStore.busy} onClick={() => undoStore.undo()}
                title={undoStore.past.length ? `Undo: ${undoStore.past[undoStore.past.length - 1].label} (Ctrl+Z)` : 'Nothing to undo'}><Undo2 size={14} /></button>
        <button type="button" className={styles.iconBtn} disabled={!undoStore.future.length || undoStore.busy} onClick={() => undoStore.redo()}
                title={undoStore.future.length ? `Redo: ${undoStore.future[0].label} (Ctrl+Y)` : 'Nothing to redo'}><Redo2 size={14} /></button>
        <button type="button" className={styles.iconBtn} onClick={() => resetLayout.mutate()} title="Auto layout (forget dragged positions)"><LayoutGrid size={14} /></button>
        <button type="button" className={styles.iconBtn} onClick={() => rf.fitView({ padding: 0.15, duration: 300 })} title="Fit to view"><Maximize2 size={14} /></button>
        <button type="button" className={styles.iconBtn} onClick={() => { g.resetView(); setSelected(null); setAnchor(null); toast.info('View reset: Ships pathway, all factions') }}
                title="Reset the view: clear the focus, faction, asset and extra-node filters"><RotateCcw size={14} /></button>
        <span className={styles.sep} />
        <button type="button" className="btn sm" onClick={() => setPicking('add')} title="Bring an existing entity into this scene as a full node"><FilePlus2 size={12} /> Add existing</button>
        <button type="button" className="btn sm" onClick={() => setCreating(true)}><Plus size={12} /> New entity</button>
      </div>

      <div className={styles.canvasRow}>
        <div className={styles.canvas}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeDragStart={onNodeDragStart} onNodeDragStop={onNodeDragStop}
                     onConnect={onConnect} onConnectEnd={onConnectEnd} onEdgesDelete={onEdgesDelete} onNodeClick={onNodeClick} onPaneClick={() => setSelected(null)}
                     onNodeMouseEnter={(_, n) => setHover(n.id)} onNodeMouseLeave={() => setHover(null)}
                     onNodeDoubleClick={(_, n) => { const r = nodeById.get(n.id); if (r && r.exists && !r.asset) openEntity(n.id) }}
                     fitView minZoom={0.1} maxZoom={1.8} deleteKeyCode={['Delete', 'Backspace']} nodesConnectable
                     onlyRenderVisibleElements={nodes.length > 150}
                     connectionRadius={28} proOptions={{ hideAttribution: true }} colorMode={theme}>
            <Background id="minor" variant={BackgroundVariant.Lines} gap={16} color="var(--grid-minor)" />
            <Background id="major" variant={BackgroundVariant.Lines} gap={128} color="var(--grid-major)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeClassName={(n) => (n.type === 'entity' ? 'is-entity' : '')} />
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
          <RelationshipDetail node={sel} edges={detailEdges} onSelect={(id) => { const r = nodeById.get(id); if (r?.proxy) g.expand(id); select(id) }}
                              onFocus={(id) => { g.setFocus(id); select(id) }} onClose={() => setSelected(null)} onDisconnect={(s, p, edge) => disconnect(s, p, edge)}
                              added={scene.includes(sel.id)} onRemoveFromScene={() => { g.exclude(sel.id); setSelected(null) }} />
        )}
      </div>

      {picking === 'focus' && <AssetPicker kind="entity" value={g.focus ?? ''} onPick={(v) => { g.setFocus(v); select(v) }} onClose={() => setPicking(null)} />}
      {picking === 'add' && (
        <AssetPicker kind="entity" value="" onClose={() => setPicking(null)}
                     onPick={(v) => { if (nodeById.get(v) && !nodeById.get(v)?.proxy) toast.info(`${v} is already in the scene`); else { g.expand(v); toast.success(`Added ${v} to the scene`) } setSelected(v) }} />
      )}
      {creating && <NewEntityDialog onClose={() => setCreating(false)} />}
      {portDrop && (
        <ContextMenu x={portDrop.x} y={portDrop.y} title={`${portDrop.source} · ${portDrop.port}`} onClose={() => setPortDrop(null)}
                     items={[
                       { label: 'New entity connected here…', icon: <Plus size={13} />, hint: entityHint(portDrop.port) || undefined,
                         onClick: () => setWire({ source: portDrop.source, port: portDrop.port, mode: 'new' }) },
                       { label: 'Connect an existing entity…', icon: <Link2 size={13} />, onClick: () => setWire({ source: portDrop.source, port: portDrop.port, mode: 'pick' }) },
                     ]} />
      )}
      {wire?.mode === 'new' && (
        <NewEntityDialog initialType={entityHint(wire.port)} onClose={() => setWire(null)}
                         onCreated={(name) => { wireUp(wire.source, wire.port, name); g.expand(name); setSelected(name) }} />
      )}
      {wire?.mode === 'pick' && (
        <AssetPicker kind="entity" value="" fieldKey={wire.port.split('.').pop()!.split('[')[0]} onClose={() => setWire(null)}
                     onPick={(v) => { wireUp(wire.source, wire.port, v); setSelected(v) }} />
      )}
    </div>
  )
}

/** The RelNode the detail panel expects for a fanned-out asset chip. */
function chipAsNode(id: string, fan: Fan): RelNode | undefined {
  const d = fan.data.get(id)
  if (!d || d.more) return undefined
  return { id, label: d.name, exists: d.exists, asset: true, kind: d.kind, proxy: true, ports: [] }
}

/** Which entity type a port normally points at, from its key (ability:2 -> Ability, buffType -> Buff, Subject -> ResearchSubject). */
function entityHint(port: string): string {
  const key = port.split('.').pop()!.split('[')[0].split(':')[0]
  const hints: Record<string, string> = {
    ability: 'Ability', buffType: 'Buff', buffTypeToRemove: 'Buff', fighterEntityDef: 'Fighter', fighterIllusionEntityDef: 'Fighter',
    squadTypeEntityDef: 'Squad', flagship: 'CapitalShip', Subject: 'ResearchSubject', prerequisite: 'ResearchSubject', ruinPlanetType: 'Planet', cargoShipType: 'Frigate',
  }
  return hints[key] ?? ''
}

export type { RelGraph }
