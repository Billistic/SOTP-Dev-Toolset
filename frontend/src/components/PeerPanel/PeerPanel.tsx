import { useQuery } from '@tanstack/react-query'
import { entitiesApi } from '@/api/entities'
import { useUiStore } from '@/store/useUiStore'
import { fmtNum, humanKey } from '@/utils/format'
import styles from './PeerPanel.module.css'

/** Where this entity sits among its peers on every comparable metric. */
export function PeerPanel({ name }: { name: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['entity', name, 'peers'], queryFn: () => entitiesApi.peers(name) })
  const openEntity = useUiStore((s) => s.openEntity)
  if (isLoading || !data) return <p className={styles.hint}>Loading…</p>
  if (!data.metrics.length) return <p className={styles.hint}>No comparable metrics for this entity type.</p>

  return (
    <div className={styles.root}>
      <header className={styles.head}>
        <span>Peer group <strong>{data.peerGroup}</strong></span>
        <span className="muted">{data.peers} peers</span>
        <details className={styles.peers}>
          <summary>show peers</summary>
          <div className={styles.peerList}>
            {data.peerNames.map((p) => <button key={p} onClick={() => openEntity(p)}>{p}</button>)}
          </div>
        </details>
      </header>
      <table className={styles.table}>
        <thead>
          <tr><th>Metric</th><th className={styles.num}>Value</th><th className={styles.num}>Median</th><th className={styles.num}>Min</th><th className={styles.num}>Max</th><th className={styles.num}>z</th><th>Percentile</th></tr>
        </thead>
        <tbody>
          {data.metrics.map((m) => {
            const z = m.z ?? 0
            const tone = Math.abs(z) >= 2 ? 'strong' : Math.abs(z) >= 1 ? 'mild' : undefined
            return (
              <tr key={m.metric} data-tone={tone}>
                <td>{humanKey(m.metric)}</td>
                <td className={styles.num}><strong>{fmtNum(m.value, 3)}</strong></td>
                <td className={styles.num}>{fmtNum(m.stats.median, 3)}</td>
                <td className={styles.num}>{fmtNum(m.stats.min, 3)}</td>
                <td className={styles.num}>{fmtNum(m.stats.max, 3)}</td>
                <td className={styles.num} data-sign={z > 0 ? 'pos' : z < 0 ? 'neg' : undefined}>{m.z === null ? '–' : (z > 0 ? '+' : '') + z.toFixed(2)}</td>
                <td>
                  {m.percentile !== null && (
                    <div className={styles.bar} title={`${m.percentile}th percentile`}>
                      <span style={{ width: `${m.percentile}%` }} />
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className={styles.note}>z uses median / MAD (robust to outliers). Rows highlighted at |z| ≥ 1 and ≥ 2.</p>
    </div>
  )
}
