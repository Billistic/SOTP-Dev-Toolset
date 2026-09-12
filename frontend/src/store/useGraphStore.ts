import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Direction = 'out' | 'in' | 'both'
export type LayoutMode = 'pipeline' | 'compact'

/** Relationship builder settings; kept across sessions so a pathway reopens where you left it. */
interface GraphState {
  categories: string[]
  focus: string | null
  depth: number
  direction: Direction
  incoming: boolean
  assetKinds: string[]
  include: string[]                 // proxies the user expanded into full nodes
  layoutMode: LayoutMode | 'auto'   // auto: pipeline for pathways, compact for a focus
  declutter: boolean                // hide links not touching the hovered / selected node
  faction: string                   // '' = all; race (UNSC) or faction (Cole) name
  setCategories: (c: string[]) => void
  toggleCategory: (c: string) => void
  setFocus: (name: string | null) => void
  setDepth: (d: number) => void
  setDirection: (d: Direction) => void
  setIncoming: (v: boolean) => void
  toggleAssetKind: (k: string) => void
  expand: (name: string) => void
  resetInclude: () => void
  setLayoutMode: (m: LayoutMode | 'auto') => void
  setDeclutter: (v: boolean) => void
  setFaction: (f: string) => void
}

export const useGraphStore = create<GraphState>()(
  persist(
    (set) => ({
      categories: ['ship'],
      focus: null,
      depth: 2,
      direction: 'out',
      incoming: false,
      assetKinds: [],
      include: [],
      layoutMode: 'auto',
      declutter: false,
      faction: '',
      setCategories: (categories) => set({ categories, include: [] }),
      toggleCategory: (c) => set((s) => ({ categories: s.categories.includes(c) ? s.categories.filter((x) => x !== c) : [...s.categories, c], include: [] })),
      setFocus: (focus) => set({ focus, include: [] }),
      setDepth: (depth) => set({ depth }),
      setDirection: (direction) => set({ direction }),
      setIncoming: (incoming) => set({ incoming }),
      toggleAssetKind: (k) => set((s) => ({ assetKinds: s.assetKinds.includes(k) ? s.assetKinds.filter((x) => x !== k) : [...s.assetKinds, k] })),
      expand: (name) => set((s) => ({ include: s.include.includes(name) ? s.include : [...s.include, name] })),
      resetInclude: () => set({ include: [] }),
      setLayoutMode: (layoutMode) => set({ layoutMode }),
      setDeclutter: (declutter) => set({ declutter }),
      setFaction: (faction) => set({ faction, include: [] }),
    }),
    { name: 'sotp-graph' },
  ),
)

/** Stable key for saved node positions: one layout per pathway / focus. */
export function layoutKey(s: Pick<GraphState, 'categories' | 'focus' | 'depth' | 'direction' | 'faction'>) {
  return s.focus ? `focus:${s.focus}:${s.direction}:${s.depth}` : `filter:${[...s.categories].sort().join('+') || 'none'}${s.faction ? `@${s.faction}` : ''}`
}
