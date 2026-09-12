import { useUiStore } from '@/store/useUiStore'
import { EntityTree } from '@/components/EntityTree/EntityTree'
import { DiagnosticsSummaryPanel } from '@/components/DiagnosticsSummaryPanel/DiagnosticsSummaryPanel'
import { ProjectSummary } from '@/components/ProjectSummary/ProjectSummary'
import styles from './Sidebar.module.css'

const TITLES: Record<string, string> = {
  explorer: 'Entities', research: 'Research tree', relationships: 'Relationships', strings: 'Strings', assets: 'Assets',
  diagnostics: 'Diagnostics', analytics: 'Analytics', balance: 'Balance', project: 'Project',
}

/** Sidebar content follows the activity bar; most views only need the entity tree beside them. */
export function Sidebar() {
  const activity = useUiStore((s) => s.activity)
  return (
    <div className={styles.root}>
      <header className={styles.header}>{TITLES[activity] ?? activity}</header>
      <div className={styles.content}>
        {activity === 'diagnostics' ? <DiagnosticsSummaryPanel />
          : activity === 'project' ? <ProjectSummary />
          : <EntityTree />}
      </div>
    </div>
  )
}
