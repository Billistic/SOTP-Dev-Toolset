import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { insightsApi } from '@/api/insights'
import { RecommendationCard } from '@/components/RecommendationCard/RecommendationCard'
import { fmtNum, humanKey } from '@/utils/format'
import styles from './BalanceView.module.css'

const CATEGORIES = ['ship', 'module', 'research']

/** Peer-group outlier report with concrete levers, plus a faction symmetry table. */
export function BalanceView() {
  const [category, setCategory] = useState('ship')
  const [z, setZ] = useState(1.5)
  const [reachableOnly, setReachableOnly] = useState(true)
  const [group, setGroup] = useState('')
  const [direction, setDirection] = useState('')
  const [tab, setTab] = useState<'recs' | 'symmetry'>('recs')

  const { data, isLoading } = useQuery({
    queryKey: ['balance', category, z, reachableOnly],
    queryFn: () => insightsApi.recommendations({ category, z, reachable_only: reachableOnly }),
    retry: false,
  })
  const { data: symmetry = [] } = useQuery({ queryKey: ['balance', 'symmetry', category, reachableOnly], queryFn: () => insightsApi.symmetry(category), enabled: tab === 'symmetry' })

  const recs = useMemo(() => (data?.recommendations ?? []).filter((r) => (!group || r.group === group) && (!direction || r.direction === direction)), [data, group, direction])
  const metricKeys = useMemo(() => {
    const first = symmetry[0]?.factions as Record<string, Record<string, number>> | undefined
    const any = first ? Object.values(first)[0] : undefined
    return any ? Object.keys(any).filter((k) => k !== 'count') : []
  }, [symmetry])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button data-active={tab === 'recs' || undefined} onClick={() => setTab('recs')}>Recommendations</button>
          <button data-active={tab === 'symmetry' || undefined} onClick={() => setTab('symmetry')}>Faction symmetry</button>
        </div>
        <select value={category} onChange={(e) => { setCategory(e.target.value); setGroup('') }}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <label className={styles.z}>threshold |z| ≥ <input type="number" step="0.5" min="0.5" max="5" value={z} onChange={(e) => setZ(Number(e.target.value) || 1.5)} /></label>
        <label className={styles.check}><input type="checkbox" checked={reachableOnly} onChange={(e) => setReachableOnly(e.target.checked)} /> only buildable units</label>
        {tab === 'recs' && (
          <>
            <select value={group} onChange={(e) => setGroup(e.target.value)}>
              <option value="">all peer groups</option>
              {data?.groups.map((g) => <option key={g.group} value={g.group}>{g.group} ({g.size})</option>)}
            </select>
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="">both directions</option><option value="over-tuned">over-tuned</option><option value="under-tuned">under-tuned</option>
            </select>
            <span className="muted">{recs.length} findings</span>
          </>
        )}
      </div>

      <div className={styles.body}>
        {isLoading && <p className={styles.hint}>Computing…</p>}
        {tab === 'recs' && data && (
          <>
            <p className={styles.explain}>
              Each unit is compared with peers sharing its type and role across all factions. Findings appear when a metric sits more than
              {' '}{data.zThreshold}σ (robust, median/MAD) from the peer median. Levers show what it would take to land on the median — treat them
              as a starting point, not a prescription.
            </p>
            <div className={styles.cards}>{recs.map((r, i) => <RecommendationCard key={`${r.entity}-${r.metric}-${i}`} rec={r} />)}</div>
            {!recs.length && <p className={styles.hint}>No outliers at this threshold.</p>}
          </>
        )}
        {tab === 'symmetry' && (
          <table className={styles.table}>
            <thead><tr><th>Peer group</th><th>Faction</th><th className={styles.num}>n</th>{metricKeys.map((k) => <th key={k} className={styles.num}>{humanKey(k)}</th>)}</tr></thead>
            <tbody>
              {symmetry.flatMap((row) => Object.entries(row.factions as Record<string, Record<string, number>>).map(([f, v], i) => (
                <tr key={`${row.group}-${f}`}>
                  {i === 0 ? <td rowSpan={Object.keys(row.factions as object).length} className={styles.group}>{String(row.group)}</td> : null}
                  <td>{f}</td><td className={styles.num}>{v.count}</td>
                  {metricKeys.map((k) => <td key={k} className={styles.num}>{fmtNum(v[k], 3)}</td>)}
                </tr>
              )))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
