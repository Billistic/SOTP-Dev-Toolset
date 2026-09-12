import dagre from '@dagrejs/dagre'

export interface LayoutItem {
  id: string
  width: number
  height: number
  category?: string | null   // ship | research | ability | ...; assets use their kind
  faction?: string | null
  proxy?: boolean
  asset?: boolean
}
export interface LayoutEdge { source: string; target: string }
export type Positions = Record<string, { x: number; y: number }>
export type LayoutMode = 'pipeline' | 'compact'

const MAX_PER_COLUMN = 16   // taller layers wrap into side-by-side sub-columns
const GAP_X = 36
const GAP_Y = 22
const LAYER_GAP = 150
const SUBLAYER_GAP = 90

/** Prior reading order of the mod pipeline; the data can reorder categories so links flow left -> right. */
const PRIOR: Record<string, number> = {
  player: 0, ship: 1, module: 1, planet: 1, squad: 2, research: 3, ability: 3, buff: 4, other: 5,
}
const ASSET_LAYER = 99

/**
 * Category -> layer.  Greedy feedback-arc heuristic: categories with more outgoing than
 * incoming links come first, ties fall back to PRIOR, assets always last.  Ships point at
 * research (prerequisites), so research lands right of ships even though it "comes first".
 */
function categoryLayers(items: LayoutItem[], links: LayoutEdge[]): Map<string, number> {
  const cat = (it: LayoutItem) => (it.asset ? '__asset' : it.category ?? 'other')
  const byId = new Map(items.map((i) => [i.id, cat(i)]))
  const flow = new Map<string, number>()
  for (const e of links) {
    const a = byId.get(e.source)!, b = byId.get(e.target)!
    if (a === b || a === '__asset' || b === '__asset') continue
    flow.set(a, (flow.get(a) ?? 0) + 1)
    flow.set(b, (flow.get(b) ?? 0) - 1)
  }
  const cats = [...new Set(items.map(cat))].filter((c) => c !== '__asset')
  cats.sort((a, b) => (flow.get(b) ?? 0) - (flow.get(a) ?? 0) || (PRIOR[a] ?? PRIOR.other) - (PRIOR[b] ?? PRIOR.other) || a.localeCompare(b))
  const layers = new Map(cats.map((c, i) => [c, i]))
  layers.set('__asset', ASSET_LAYER)
  return layers
}

export function layoutGraph(items: LayoutItem[], edges: LayoutEdge[], mode: LayoutMode = 'pipeline'): Positions {
  if (!items.length) return {}
  return mode === 'compact' ? compact(items, edges) : pipeline(items, edges)
}

// ── pipeline: semantic columns + intra-column chains + barycenter ordering ──
function pipeline(items: LayoutItem[], edges: LayoutEdge[]): Positions {
  const byId = new Map(items.map((i) => [i.id, i]))
  const links = edges.filter((e) => byId.has(e.source) && byId.has(e.target) && e.source !== e.target)
  const out = new Map<string, string[]>()
  const inn = new Map<string, string[]>()
  for (const e of links) {
    out.set(e.source, [...(out.get(e.source) ?? []), e.target])
    inn.set(e.target, [...(inn.get(e.target) ?? []), e.source])
  }

  // 1. layer by category; chains inside a category (research -> research) get sub-layers by longest path
  const catLayer = categoryLayers(items, links)
  const layer = new Map<string, number>()
  for (const it of items) layer.set(it.id, catLayer.get(it.asset ? '__asset' : it.category ?? 'other') ?? 0)
  const sub = subLayers(items, links, layer)
  const columnKey = (id: string) => layer.get(id)! * 100 + sub.get(id)!
  const columns = new Map<number, LayoutItem[]>()
  for (const it of items) columns.set(columnKey(it.id), [...(columns.get(columnKey(it.id)) ?? []), it])
  const keys = [...columns.keys()].sort((a, b) => a - b)

  // 2. initial order: faction, then name, so factions stay contiguous when nothing else decides
  const pos = new Map<string, number>()
  for (const k of keys) {
    const col = columns.get(k)!.sort((a, b) => (a.faction ?? '~').localeCompare(b.faction ?? '~') || a.id.localeCompare(b.id))
    col.forEach((it, i) => pos.set(it.id, i))
  }

  // 3. barycenter sweeps: place each node at the mean position of its neighbours in adjacent columns
  const bary = (neighbours: string[]) => {
    const ns = neighbours.filter((n) => byId.has(n))
    return ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : null
  }
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 === 0 ? keys : [...keys].reverse()
    for (const k of order) {
      const col = columns.get(k)!
      const score = new Map<string, number>()
      col.forEach((it, i) => {
        const b = sweep % 2 === 0 ? bary(inn.get(it.id) ?? []) : bary(out.get(it.id) ?? [])
        score.set(it.id, b ?? i)
      })
      col.sort((a, b) => score.get(a.id)! - score.get(b.id)! || (a.faction ?? '~').localeCompare(b.faction ?? '~') || a.id.localeCompare(b.id))
      col.forEach((it, i) => pos.set(it.id, i))
    }
  }

  // 4. place: each column may wrap into sub-columns; columns are vertically centred on a common axis
  const placed: Positions = {}
  const colHeights: number[] = []
  const layouts = keys.map((k) => {
    const col = columns.get(k)!
    const cols = Math.max(1, Math.ceil(col.length / MAX_PER_COLUMN))
    const perCol = Math.ceil(col.length / cols)
    // wrapped block: nodes with the most links to the right sit in the rightmost sub-column (shortest edges)
    const rightLinks = (id: string) => (out.get(id) ?? []).filter((t) => layer.get(t)! > layer.get(id)!).length
    const ranked = [...col].sort((a, b) => rightLinks(a.id) - rightLinks(b.id))
    const chunkOf = new Map(ranked.map((it, i) => [it.id, Math.min(cols - 1, Math.floor(i / perCol))]))
    const chunks = Array.from({ length: cols }, (_, c) => col.filter((it) => chunkOf.get(it.id) === c))
    const height = Math.max(...chunks.map((ch) => ch.reduce((h, it) => h + it.height + GAP_Y, -GAP_Y)))
    colHeights.push(height)
    return { key: k, chunks, width: Math.max(...col.map((i) => i.width)) }
  })
  const axis = Math.max(...colHeights) / 2
  let x = 20
  let prevLayer = -1
  for (const { key, chunks, width } of layouts) {
    const thisLayer = Math.floor(key / 100)
    if (prevLayer !== -1) x += thisLayer === prevLayer ? SUBLAYER_GAP : LAYER_GAP
    prevLayer = thisLayer
    chunks.forEach((chunk, c) => {
      const h = chunk.reduce((s, it) => s + it.height + GAP_Y, -GAP_Y)
      let y = 20 + axis - h / 2
      for (const it of chunk) { placed[it.id] = { x: x + c * (width + GAP_X), y }; y += it.height + GAP_Y }
    })
    x += chunks.length * (width + GAP_X) - GAP_X
  }
  return placed
}

/** Longest-path depth along edges that stay inside one layer (research prerequisite chains, buff -> buff). */
function subLayers(items: LayoutItem[], links: LayoutEdge[], layer: Map<string, number>): Map<string, number> {
  const intra = new Map<string, string[]>()
  for (const e of links) if (layer.get(e.source) === layer.get(e.target)) intra.set(e.target, [...(intra.get(e.target) ?? []), e.source])
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const dfs = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!
    if (visiting.has(id)) return 0          // cycle guard
    visiting.add(id)
    const d = Math.max(0, ...(intra.get(id) ?? []).map((p) => dfs(p) + 1))
    visiting.delete(id)
    depth.set(id, d)
    return d
  }
  for (const it of items) dfs(it.id)
  return depth
}

// ── compact: plain dagre with tall ranks wrapped (good for small focus graphs) ─
function compact(items: LayoutItem[], edges: LayoutEdge[]): Positions {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', ranksep: 110, nodesep: GAP_Y, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  const ids = new Set(items.map((i) => i.id))
  for (const it of items) g.setNode(it.id, { width: it.width, height: it.height })
  for (const e of edges) if (ids.has(e.source) && ids.has(e.target) && e.source !== e.target) g.setEdge(e.source, e.target)
  dagre.layout(g)
  const byRank = new Map<number, LayoutItem[]>()
  for (const it of items) {
    const n = g.node(it.id)
    if (n) byRank.set(Math.round(n.x), [...(byRank.get(Math.round(n.x)) ?? []), it])
  }
  const ranks = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list.sort((a, b) => g.node(a.id).y - g.node(b.id).y))
  const out: Positions = {}
  let x0 = 20
  for (const list of ranks) {
    const cols = Math.max(1, Math.ceil(list.length / MAX_PER_COLUMN))
    const perCol = Math.ceil(list.length / cols)
    const colWidth = Math.max(...list.map((i) => i.width)) + GAP_X
    list.forEach((it, i) => {
      const c = Math.floor(i / perCol), r = i % perCol
      const above = list.slice(c * perCol, c * perCol + r).reduce((h, o) => h + o.height + GAP_Y, 0)
      out[it.id] = { x: x0 + c * colWidth, y: 20 + above }
    })
    x0 += cols * colWidth + 110
  }
  return out
}
