import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { entitiesApi } from '@/api/entities'
import { tabId, useUiStore, type Tab } from '@/store/useUiStore'
import styles from './TabBar.module.css'

const VIEW_LABELS: Record<string, string> = {
  research: 'Research tree', relationships: 'Relationships', strings: 'Strings', assets: 'Assets', diagnostics: 'Diagnostics',
  analytics: 'Analytics', balance: 'Balance', project: 'Project',
}

function label(t: Tab) {
  return t.kind === 'entity' ? t.name : VIEW_LABELS[t.view] ?? t.view
}

export function TabBar() {
  const { tabs, activeTab, setActiveTab, closeTab } = useUiStore()
  const { data: dirty } = useQuery({ queryKey: ['entities', 'dirty'], queryFn: () => entitiesApi.list({ dirty: true }), retry: false })
  const dirtyNames = new Set((dirty ?? []).map((e) => e.name))
  if (!tabs.length) return <div className={styles.bar} />

  return (
    <div className={styles.bar} role="tablist">
      {tabs.map((t) => {
        const id = tabId(t)
        const isDirty = t.kind === 'entity' && dirtyNames.has(t.name)
        return (
          <div key={id} role="tab" aria-selected={activeTab === id} className={styles.tab} data-active={activeTab === id || undefined}
               onClick={() => setActiveTab(id)} onAuxClick={(e) => { if (e.button === 1) closeTab(id) }} title={label(t)}>
            <span className={styles.label} data-kind={t.kind}>{label(t)}</span>
            {isDirty && <span className={styles.dirty} title="Unsaved changes" />}
            <button className={styles.close} onClick={(e) => { e.stopPropagation(); closeTab(id) }} aria-label="Close tab"><X size={13} /></button>
          </div>
        )
      })}
    </div>
  )
}
