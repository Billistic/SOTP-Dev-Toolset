import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Which sidebar/workspace view the activity bar has selected. */
export type ActivityView =
  | 'explorer' | 'research' | 'relationships' | 'strings' | 'assets' | 'diagnostics' | 'analytics' | 'balance' | 'project'

/** Editor tabs: entities open as tabs; other views are singletons. */
export type Tab =
  | { kind: 'entity'; name: string }
  | { kind: 'view'; view: Exclude<ActivityView, 'explorer'> }

export const tabId = (t: Tab) => (t.kind === 'entity' ? `entity:${t.name}` : `view:${t.view}`)

export type EditorMode = 'form' | 'tree' | 'raw' | 'weapons' | 'references' | 'peers' | 'buffs'
export type Theme = 'dark' | 'light' | 'system'

/** Views whose sidebar carries something useful; the rest are full-width workspaces. */
const SIDEBAR_VIEWS: ReadonlySet<ActivityView> = new Set(['explorer', 'diagnostics', 'project'])

interface UiState {
  activity: ActivityView
  sidebarVisible: boolean
  sidebarWidth: number
  bottomVisible: boolean
  bottomHeight: number
  tabs: Tab[]
  activeTab: string | null
  editorMode: EditorMode
  collapsedGroups: string[]
  theme: Theme
  setActivity: (v: ActivityView) => void
  toggleSidebar: () => void
  setSidebarWidth: (w: number) => void
  toggleBottom: () => void
  setBottomHeight: (h: number) => void
  openEntity: (name: string) => void
  openView: (view: Exclude<ActivityView, 'explorer'>) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setEditorMode: (m: EditorMode) => void
  toggleGroup: (key: string) => void
  setGroups: (keys: string[], collapsed: boolean) => void
  setTheme: (t: Theme) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      activity: 'explorer',
      sidebarVisible: true,
      sidebarWidth: 280,
      bottomVisible: true,
      bottomHeight: 220,
      tabs: [],
      activeTab: null,
      editorMode: 'form',
      collapsedGroups: [],
      theme: 'dark',

      setActivity: (activity) => {
        const s = get()
        if (activity === s.activity && SIDEBAR_VIEWS.has(activity)) { set({ sidebarVisible: !s.sidebarVisible }); return }
        set({ activity, sidebarVisible: SIDEBAR_VIEWS.has(activity) })
        if (activity !== 'explorer') s.openView(activity)
      },
      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
      setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
      toggleBottom: () => set((s) => ({ bottomVisible: !s.bottomVisible })),
      setBottomHeight: (bottomHeight) => set({ bottomHeight }),

      openEntity: (name) => {
        const tab: Tab = { kind: 'entity', name }
        const id = tabId(tab)
        set((s) => ({ tabs: s.tabs.some((t) => tabId(t) === id) ? s.tabs : [...s.tabs, tab], activeTab: id }))
      },
      openView: (view) => {
        const tab: Tab = { kind: 'view', view }
        const id = tabId(tab)
        set((s) => ({ tabs: s.tabs.some((t) => tabId(t) === id) ? s.tabs : [...s.tabs, tab], activeTab: id }))
      },
      closeTab: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => tabId(t) !== id)
          const activeTab = s.activeTab === id ? (tabs.length ? tabId(tabs[tabs.length - 1]) : null) : s.activeTab
          return { tabs, activeTab }
        }),
      setActiveTab: (activeTab) => set({ activeTab }),
      setEditorMode: (editorMode) => set({ editorMode }),
      toggleGroup: (key) =>
        set((s) => ({ collapsedGroups: s.collapsedGroups.includes(key) ? s.collapsedGroups.filter((k) => k !== key) : [...s.collapsedGroups, key] })),
      setGroups: (keys, collapsed) =>
        set((s) => ({ collapsedGroups: collapsed ? Array.from(new Set([...s.collapsedGroups, ...keys])) : s.collapsedGroups.filter((k) => !keys.includes(k)) })),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'sotp-ui',
      partialize: (s) => ({ sidebarWidth: s.sidebarWidth, bottomHeight: s.bottomHeight, tabs: s.tabs, activeTab: s.activeTab, collapsedGroups: s.collapsedGroups, theme: s.theme }),
    },
  ),
)
