import { useQuery } from '@tanstack/react-query'
import { catalogApi } from '@/api/catalog'
import { useDiagnosticsFilter } from '@/store/useDiagnosticsFilter'
import { useUiStore } from '@/store/useUiStore'
import { severityColor } from '@/utils/format'
import styles from './DiagnosticsSummaryPanel.module.css'

/** Sidebar for the diagnostics view: counts by severity and by code, each one a filter. */
export function DiagnosticsSummaryPanel() {
  const { data } = useQuery({ queryKey: ['diagnostics', 'summary'], queryFn: catalogApi.diagnosticsSummary, retry: false })
  const filter = useDiagnosticsFilter()
  const openView = useUiStore((s) => s.openView)
  const pick = (patch: Parameters<typeof filter.set>[0]) => { filter.set(patch); openView('diagnostics') }
  if (!data) return <p className={styles.hint}>No diagnostics yet.</p>

  return (
    <div className={styles.root}>
      <div className={styles.sevRow}>
        {(['error', 'warning', 'info'] as const).map((s) => (
          <button key={s} className={styles.sev} data-active={filter.severity === s || undefined} style={{ color: severityColor(s) }}
                  onClick={() => pick({ severity: filter.severity === s ? null : s, code: null })}>
            <strong>{data.bySeverity[s] ?? 0}</strong><span>{s}</span>
          </button>
        ))}
      </div>
      <button className={styles.clear} onClick={() => { filter.reset(); openView('diagnostics') }}>All diagnostics</button>
      <ul className={styles.codes}>
        {data.byCode.map((c) => (
          <li key={`${c.code}-${c.severity}`}>
            <button className={styles.codeBtn} data-active={filter.code === c.code || undefined}
                    onClick={() => pick({ code: filter.code === c.code ? null : c.code, severity: null })}>
              <span className={styles.dot} style={{ background: severityColor(c.severity) }} />
              <span className={styles.code}>{c.code}</span>
              <span className={styles.n}>{c.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
