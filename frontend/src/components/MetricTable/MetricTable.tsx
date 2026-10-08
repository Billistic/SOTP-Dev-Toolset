import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useUiStore } from '@/store/useUiStore'
import { factionColor, fmtNum, humanKey } from '@/utils/format'
import { useFactions } from '@/hooks/useFactions'
import type { MetricTable as MetricTableData } from '@/types/api'
import styles from './MetricTable.module.css'

/** Sortable, filterable table of typed metrics with per-column heat shading. */
export function MetricTable({ table }: { table: MetricTableData }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [faction, setFaction] = useState('')
  const { raceOf } = useFactions()
  const [role, setRole] = useState('')
  const [filter, setFilter] = useState('')
  const openEntity = useUiStore((s) => s.openEntity)

  const factions = useMemo(() => [...new Set(table.rows.map((r) => String(r.faction ?? '')))].filter(Boolean).sort(), [table])
  const roles = useMemo(() => [...new Set(table.rows.map((r) => String(r.role ?? '')))].filter(Boolean).sort(), [table])

  const rows = useMemo(() => {
    const f = filter.toLowerCase()
    const out = table.rows.filter((r) => (!faction || r.faction === faction) && (!role || r.role === role) && (!f || String(r.name).toLowerCase().includes(f)))
    return out.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir
      return String(av ?? '').localeCompare(String(bv ?? '')) * sort.dir
    })
  }, [table, sort, faction, role, filter])

  const ranges = useMemo(() => {
    const r: Record<string, [number, number]> = {}
    for (const m of table.metrics) {
      const vals = rows.map((x) => x[m]).filter((v): v is number => typeof v === 'number')
      if (vals.length) r[m] = [Math.min(...vals), Math.max(...vals)]
    }
    return r
  }, [rows, table.metrics])

  const heat = (m: string, v: unknown) => {
    const range = ranges[m]
    if (typeof v !== 'number' || !range || range[1] === range[0]) return undefined
    const t = (v - range[0]) / (range[1] - range[0])
    return { background: `color-mix(in srgb, var(--accent) ${Math.round(4 + t * 30)}%, transparent)` }
  }
  const toggleSort = (key: string) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))

  return (
    <div className={styles.root}>
      <div className={styles.filters}>
        <input type="search" placeholder="filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={faction} onChange={(e) => setFaction(e.target.value)}><option value="">all factions</option>{factions.map((f) => <option key={f}>{f}</option>)}</select>
        <select value={role} onChange={(e) => setRole(e.target.value)}><option value="">all roles</option>{roles.map((r) => <option key={r}>{r}</option>)}</select>
        <span className="muted">{rows.length} rows</span>
      </div>
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              {['name', 'faction', 'role', ...table.metrics].map((k) => (
                <th key={k} onClick={() => toggleSort(k)} className={k === 'name' ? styles.sticky : undefined} title={k}>
                  <span>{humanKey(k)}</span>{sort.key === k && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.name)}>
                <td className={styles.sticky}><button className={styles.link} onClick={() => openEntity(String(r.name))} title={String(r.displayName ?? '')}>{String(r.name)}</button></td>
                <td><i className={styles.swatch} style={{ background: factionColor(raceOf(r.faction)) }} />{String(r.faction ?? '')}</td>
                <td className={styles.role}>{String(r.role ?? '')}</td>
                {table.metrics.map((m) => <td key={m} className={styles.num} style={heat(m, r[m])}>{fmtNum(r[m], 3)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
