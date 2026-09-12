import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowUpCircle, CircleX, Database, PanelBottom, RefreshCw } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { entitiesApi } from '@/api/entities'
import { useProject } from '@/hooks/useProject'
import { useUpdates } from '@/hooks/useUpdates'
import { useUiStore } from '@/store/useUiStore'
import styles from './StatusBar.module.css'

export function StatusBar() {
  const { project, ingest } = useProject()
  const updates = useUpdates(false)
  const toggleBottom = useUiStore((s) => s.toggleBottom)
  const setActivity = useUiStore((s) => s.setActivity)
  const { data: summary } = useQuery({ queryKey: ['diagnostics', 'summary'], queryFn: catalogApi.diagnosticsSummary, enabled: !!project, retry: false })
  const { data: dirty } = useQuery({ queryKey: ['entities', 'dirty'], queryFn: () => entitiesApi.list({ dirty: true }), enabled: !!project, retry: false })

  const errors = summary?.bySeverity?.error ?? 0
  const warnings = summary?.bySeverity?.warning ?? 0

  return (
    <footer className={styles.bar}>
      <button className={styles.item} onClick={() => setActivity('project')} title={project?.modRoot ?? 'No project'}>
        <Database size={12} /> {project ? project.name : 'No project'}
      </button>
      <button className={styles.item} onClick={() => setActivity('diagnostics')} title="Diagnostics">
        <CircleX size={12} className={styles.err} /> {errors}
        <AlertTriangle size={12} className={styles.warn} /> {warnings}
      </button>
      {dirty && dirty.length > 0 && (
        <span className={styles.item} title="Entities edited but not written to disk">
          <span className={styles.dot} /> {dirty.length} unsaved
        </span>
      )}
      <span className={styles.spacer} />
      {project && (
        <button className={styles.item} onClick={() => ingest.mutate({ id: project.id })} disabled={ingest.isPending} title="Re-scan the mod folder">
          <RefreshCw size={12} className={ingest.isPending ? styles.spin : undefined} /> {ingest.isPending ? 'Ingesting…' : 'Ingest'}
        </button>
      )}
      <button className={styles.item} onClick={() => updates.check.mutate()} disabled={updates.check.isPending}
              title={updates.available ? `Update ${updates.info?.latest} available` : 'Click to check for updates'} data-update={updates.available || undefined}>
        {updates.available ? <ArrowUpCircle size={12} className={styles.update} /> : null} v{updates.info?.current ?? '…'}
      </button>
      <button className={styles.item} onClick={toggleBottom} title="Toggle problems panel (Ctrl+`)"><PanelBottom size={12} /></button>
    </footer>
  )
}
