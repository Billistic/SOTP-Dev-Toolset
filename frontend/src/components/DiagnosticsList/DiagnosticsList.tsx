import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CircleX, Info } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { entitiesApi } from '@/api/entities'
import { useUiStore } from '@/store/useUiStore'
import type { Diagnostic } from '@/types/api'
import styles from './DiagnosticsList.module.css'

interface Props {
  entityName?: string | null       // restrict to one entity (bottom panel)
  entityScope?: boolean            // true: entityName null means "nothing open" rather than "all"
  severity?: string | null
  code?: string | null
  scope?: string | null
  search?: string
  compact?: boolean
  limit?: number
}

const Icon = ({ s }: { s: string }) =>
  s === 'error' ? <CircleX size={14} className={styles.error} /> : s === 'warning' ? <AlertTriangle size={14} className={styles.warning} /> : <Info size={14} className={styles.info} />

/** Flat diagnostics list; clicking a row opens the entity (and the raw view at that line). */
export function DiagnosticsList({ entityName, entityScope, severity, code, scope, search, compact, limit = 2000 }: Props) {
  const openEntity = useUiStore((s) => s.openEntity)
  const setEditorMode = useUiStore((s) => s.setEditorMode)
  const byEntity = useQuery({
    queryKey: ['diagnostics', 'entity', entityName],
    queryFn: () => entitiesApi.diagnostics(entityName!),
    enabled: !!entityName,
  })
  const all = useQuery({
    queryKey: ['diagnostics', 'list', severity, code, scope, search, limit],
    queryFn: () => catalogApi.diagnostics({ severity: severity ?? undefined, code: code ?? undefined, scope: scope ?? undefined, search: search || undefined, limit }),
    enabled: !entityName && !entityScope,
    retry: false,
  })
  if (entityScope && !entityName) return <p className={styles.hint}>Open an entity to see its problems, or switch to Project.</p>
  const rows: Diagnostic[] = (entityName ? byEntity.data : all.data) ?? []
  const loading = entityName ? byEntity.isLoading : all.isLoading

  if (loading) return <p className={styles.hint}>Loading…</p>
  if (!rows.length) return <p className={styles.hint}>No diagnostics.</p>

  return (
    <ul className={styles.list} data-compact={compact || undefined}>
      {rows.map((d) => (
        <li key={d.id} className={styles.row} onClick={() => { if (d.entityName) { openEntity(d.entityName); if (d.line) setEditorMode('raw') } }}
            data-clickable={!!d.entityName || undefined} title={d.path ?? undefined}>
          <Icon s={d.severity} />
          <span className={styles.code}>{d.code}</span>
          {!entityName && d.entityName && <span className={styles.entity}>{d.entityName}</span>}
          <span className={styles.msg}>{d.message}</span>
          {d.line && <span className={styles.line}>:{d.line}</span>}
          {!compact && <span className={styles.scope}>{d.scope}</span>}
        </li>
      ))}
      {rows.length >= limit && <li className={styles.hint}>Showing first {limit}; narrow the filter to see more.</li>}
    </ul>
  )
}
