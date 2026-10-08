import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { insightsApi } from '@/api/insights'
import { RecommendationCard } from '@/components/RecommendationCard/RecommendationCard'
import { PromptDialog } from '@/components/PromptDialog/PromptDialog'
import { toast } from '@/store/useToastStore'
import { useUiStore } from '@/store/useUiStore'
import { fmtNum, humanKey } from '@/utils/format'
import styles from './BalanceView.module.css'

const CATEGORIES = ['ship', 'module', 'research']
const REASONS: Record<string, string> = { dev: 'dev / test', debug: 'debug', empty: 'empty / stub', ai: 'AI driver', other: 'other' }

/** Peer-group outlier report with concrete levers, plus a faction symmetry table. */
export function BalanceView() {
  const [category, setCategory] = useState('ship')
  const [z, setZ] = useState(1.5)
  const [reachableOnly, setReachableOnly] = useState(true)
  const [group, setGroup] = useState('')
  const [direction, setDirection] = useState('')
  const [tab, setTab] = useState<'recs' | 'symmetry' | 'excluded'>('recs')
  const [excluding, setExcluding] = useState<string | null>(null)
  const qc = useQueryClient()
  const openEntity = useUiStore((s) => s.openEntity)

  const { data, isLoading } = useQuery({
    queryKey: ['balance', category, z, reachableOnly],
    queryFn: () => insightsApi.recommendations({ category, z, reachable_only: reachableOnly }),
    retry: false,
  })
  const { data: symmetry = [] } = useQuery({ queryKey: ['balance', 'symmetry', category, reachableOnly], queryFn: () => insightsApi.symmetry(category, reachableOnly), enabled: tab === 'symmetry' })
  // QA #3: dev / debug / empty / AI-driver units stay out of every peer group
  const exclude = useMutation({
    mutationFn: ({ name, reason, note }: { name: string; reason: string; note?: string }) => insightsApi.excludeFromBalance(name, reason, note),
    onSuccess: (x) => { setExcluding(null); qc.invalidateQueries({ queryKey: ['balance'] }); toast.info(`${x.entity} left out of the balance statistics`) },
    onError: (e: Error) => toast.error(e.message),
  })
  const include = useMutation({
    mutationFn: (name: string) => insightsApi.includeInBalance(name),
    onSuccess: (_r, name) => { qc.invalidateQueries({ queryKey: ['balance'] }); toast.info(`${name} counted again`) },
    onError: (e: Error) => toast.error(e.message),
  })
  const excluded = data?.excluded ?? []

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
          <button data-active={tab === 'excluded' || undefined} onClick={() => setTab('excluded')}>Excluded{excluded.length ? ` (${excluded.length})` : ''}</button>
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
            <div className={styles.cards}>{recs.map((r, i) => <RecommendationCard key={`${r.entity}-${r.metric}-${i}`} rec={r} onExclude={() => setExcluding(r.entity)} />)}</div>
            {!recs.length && <p className={styles.hint}>No outliers at this threshold.</p>}
          </>
        )}
        {tab === 'excluded' && (
          <>
            <p className={styles.explain}>
              These entities are left out of every peer group, so they neither get findings nor shift the medians other units are compared with.
              Use it for dev, debug, empty and AI-driver entities that players never field. Analytics tables still list them.
            </p>
            {excluded.length ? (
              <table className={styles.table}>
                <thead><tr><th>Entity</th><th>Reason</th><th>Note</th><th></th></tr></thead>
                <tbody>
                  {excluded.map((x) => (
                    <tr key={x.entity}>
                      <td><button className={styles.link} onClick={() => openEntity(x.entity)}>{x.entity}</button></td>
                      <td>{REASONS[x.reason] ?? x.reason}</td>
                      <td className="muted">{x.note ?? ''}</td>
                      <td><button className="btn sm" onClick={() => include.mutate(x.entity)} disabled={include.isPending} title="Count this entity in the statistics again"><Undo2 size={12} /> Include</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className={styles.hint}>Nothing excluded. Use the <strong>hide</strong> button on a recommendation to leave an entity out.</p>}
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
      {excluding && (
        <PromptDialog title={`Exclude ${excluding} from balance`} submitLabel="Exclude" busy={exclude.isPending}
                      fields={[{ name: 'reason', label: 'Why', options: Object.keys(REASONS), hint: Object.entries(REASONS).map(([k, v]) => `${k} = ${v}`).join(' \u00b7 ') },
                               { name: 'note', label: 'Note (optional)', placeholder: 'e.g. scripted AI flagship' }]}
                      onSubmit={(v) => exclude.mutate({ name: excluding, reason: v.reason, note: v.note })} onClose={() => setExcluding(null)} />
      )}
    </div>
  )
}
