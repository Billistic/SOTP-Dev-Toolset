import { useState } from 'react'
import { X } from 'lucide-react'
import { DiagnosticsList } from '@/components/DiagnosticsList/DiagnosticsList'
import { tabId, useUiStore } from '@/store/useUiStore'
import styles from './BottomPanel.module.css'

type Scope = 'entity' | 'all'

/** Problems panel: diagnostics for the open entity, or the whole project. */
export function BottomPanel() {
  const [scope, setScope] = useState<Scope>('entity')
  const toggleBottom = useUiStore((s) => s.toggleBottom)
  const tabs = useUiStore((s) => s.tabs)
  const activeTab = useUiStore((s) => s.activeTab)
  const tab = tabs.find((t) => tabId(t) === activeTab)
  const entityName = tab?.kind === 'entity' ? tab.name : null

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.tab} data-active={scope === 'entity' || undefined} onClick={() => setScope('entity')}>
          Problems{entityName ? `: ${entityName}` : ''}
        </button>
        <button className={styles.tab} data-active={scope === 'all' || undefined} onClick={() => setScope('all')}>Project</button>
        <span className={styles.spacer} />
        <button className={styles.close} onClick={toggleBottom} title="Close panel (Ctrl+`)"><X size={14} /></button>
      </header>
      <div className={styles.body}>
        <DiagnosticsList entityName={scope === 'entity' ? entityName : null} entityScope={scope === 'entity'} compact limit={500} />
      </div>
    </div>
  )
}
