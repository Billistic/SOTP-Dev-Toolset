import { Download, RefreshCw, RotateCcw } from 'lucide-react'
import { useUpdates } from '@/hooks/useUpdates'
import { fmtBytes } from '@/utils/format'
import styles from './UpdatesCard.module.css'

/** "About & updates" block in Project settings: version, release channel, manual check, download / restart. */
export function UpdatesCard() {
  const { info, status, available, check, download, install, skipped } = useUpdates(false)
  const st = status?.state ?? 'idle'
  return (
    <section className={styles.card}>
      <h3 className={styles.title}>About &amp; updates</h3>
      <dl className={styles.facts}>
        <dt>Version</dt><dd>{info?.current ?? '\u2026'}{info && !info.supported && <span className={styles.note}> (dev server - installs only from the desktop app)</span>}</dd>
        <dt>Channel</dt><dd><a className={styles.link} href={`https://github.com/${info?.repo ?? ''}/releases`} target="_blank" rel="noreferrer">github.com/{info?.repo}</a></dd>
        <dt>Latest</dt><dd>{info?.latest ?? '\u2014'}{info?.checkedAt ? <span className={styles.note}> checked {new Date(info.checkedAt * 1000).toLocaleTimeString()}</span> : null}{info?.error && <span className={styles.err}> {info.error}</span>}</dd>
        {status?.signature && <><dt>Signature</dt><dd>{status.signature}</dd></>}
      </dl>
      <div className={styles.actions}>
        <button className="btn sm" onClick={() => check.mutate()} disabled={check.isPending}><RefreshCw size={12} className={check.isPending ? styles.spin : undefined} /> Check for updates</button>
        {available && (st === 'idle' || st === 'failed') && (
          <button className="btn sm primary" onClick={() => download.mutate()} disabled={!info?.supported}><Download size={12} /> Download {info?.latest}{info?.size ? ` (${fmtBytes(info.size)})` : ''}</button>
        )}
        {st === 'ready' && <button className="btn sm primary" onClick={() => install.mutate()} disabled={!info?.supported}><RotateCcw size={12} /> Restart to update</button>}
        {(st === 'downloading' || st === 'verifying') && <span className={styles.note}>{st}\u2026 {status?.total ? Math.round((status.received / status.total) * 100) : 0}%</span>}
        {skipped && info?.latest === skipped && <span className={styles.note}>version {skipped} skipped; it stays available here</span>}
      </div>
      {info?.available && info.notes && <pre className={styles.notes}>{info.notes}</pre>}
    </section>
  )
}
