import { Download, RotateCcw, X } from 'lucide-react'
import { useUpdates } from '@/hooks/useUpdates'
import { fmtBytes } from '@/utils/format'
import styles from './UpdateBanner.module.css'

/** Discord-style strip under the tab bar: new version -> download in the background -> restart to update. */
export function UpdateBanner() {
  const { info, status, available, download, install, skip } = useUpdates()
  if (!info || !available || !info.latest) return null
  const st = status?.state ?? 'idle'
  const pct = status?.total ? Math.round((status.received / status.total) * 100) : null

  return (
    <div className={styles.bar} role="status" data-state={st}>
      <span className={styles.text}>
        {st === 'ready' ? <>SOTP Dev Env <strong>{info.latest}</strong> is downloaded and verified.</>
          : st === 'downloading' || st === 'verifying' ? <>Downloading <strong>{info.latest}</strong>{pct !== null ? ` - ${pct}%` : ''}{status?.total ? ` of ${fmtBytes(status.total)}` : ''}{st === 'verifying' ? ' - verifying signature' : ''}</>
          : st === 'installing' ? <>Installing <strong>{info.latest}</strong>; the app will restart.</>
          : <>SOTP Dev Env <strong>{info.latest}</strong> is available{info.size ? ` (${fmtBytes(info.size)})` : ''}.</>}
        {info.releaseUrl && st === 'idle' && <a className={styles.link} href={info.releaseUrl} target="_blank" rel="noreferrer">What's new</a>}
      </span>
      {(st === 'downloading' || st === 'verifying') && <span className={styles.progress}><span style={{ width: `${pct ?? 100}%` }} /></span>}
      <span className={styles.spacer} />
      {st === 'ready' ? (
        <button className="btn sm primary" onClick={() => install.mutate()} disabled={install.isPending || !info.supported} title={info.supported ? 'Close and update now' : 'Only available in the desktop app'}>
          <RotateCcw size={12} /> Restart to update
        </button>
      ) : (st === 'idle' || st === 'failed') ? (
        <button className="btn sm primary" onClick={() => download.mutate()} disabled={download.isPending || !info.supported} title={info.supported ? 'Download in the background' : 'Only available in the desktop app'}>
          <Download size={12} /> {st === 'failed' ? 'Retry' : 'Download'}
        </button>
      ) : null}
      {st !== 'installing' && <button className={styles.close} onClick={() => skip(info.latest!)} title="Skip this version" aria-label="Skip this version"><X size={13} /></button>}
    </div>
  )
}
