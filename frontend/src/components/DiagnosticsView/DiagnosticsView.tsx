import { useQueryClient } from '@tanstack/react-query'
import { Play, Search } from 'lucide-react'
import { DiagnosticsList } from '@/components/DiagnosticsList/DiagnosticsList'
import { useDebounce } from '@/hooks/useDebounce'
import { useProject } from '@/hooks/useProject'
import { useDiagnosticsFilter } from '@/store/useDiagnosticsFilter'
import styles from './DiagnosticsView.module.css'

const SCOPES = ['entity', 'reference', 'manifest', 'player', 'research', 'string', 'asset']

export function DiagnosticsView() {
  const f = useDiagnosticsFilter()
  const search = useDebounce(f.search)
  const { project, validate } = useProject()
  const qc = useQueryClient()

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.search}><Search size={14} /><input type="search" data-bare placeholder="Filter by message, entity or target…" value={f.search} onChange={(e) => f.set({ search: e.target.value })} /></div>
        <select value={f.severity ?? ''} onChange={(e) => f.set({ severity: e.target.value || null })}>
          <option value="">any severity</option><option value="error">error</option><option value="warning">warning</option><option value="info">info</option>
        </select>
        <select value={f.scope ?? ''} onChange={(e) => f.set({ scope: e.target.value || null })}>
          <option value="">any scope</option>{SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {f.code && <button className="btn sm" onClick={() => f.set({ code: null })}>code: {f.code} ✕</button>}
        <span className={styles.spacer} />
        <button className="btn sm primary" disabled={!project || validate.isPending}
                onClick={() => project && validate.mutate(project.id, { onSuccess: () => qc.invalidateQueries({ queryKey: ['diagnostics'] }) })}>
          <Play size={12} /> {validate.isPending ? 'Validating…' : 'Re-validate'}
        </button>
      </div>
      <div className={styles.body}>
        <DiagnosticsList severity={f.severity} code={f.code} scope={f.scope} search={search} />
      </div>
    </div>
  )
}
