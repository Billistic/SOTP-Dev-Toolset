import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useDesktop } from '@/hooks/useDesktop'
import { useProject } from '@/hooks/useProject'
import { Emblem } from '@/components/Brand/Brand'
import styles from './TitleBar.module.css'

/**
 * Custom caption for the frameless desktop window (Discord / Claude Desktop style): brand on the
 * left, a drag region, and native-feeling minimise / maximise / close. Renders nothing in a browser.
 */
export function TitleBar() {
  const api = useDesktop()
  const { project } = useProject()
  const [maximized, setMaximized] = useState(false)
  useEffect(() => { api?.is_maximized().then(setMaximized).catch(() => undefined) }, [api])
  if (!api) return null
  const toggle = () => api.toggle_maximize().then(setMaximized).catch(() => undefined)

  return (
    <header className={styles.bar}>
      <div className={`${styles.brand} pywebview-drag-region`} onDoubleClick={toggle}>
        <Emblem size={16} />
        <span className={styles.title}>SOTP Dev Env</span>
        {project && <span className={styles.project}>{project.name}</span>}
      </div>
      <div className={`${styles.drag} pywebview-drag-region`} onDoubleClick={toggle} />
      <div className={styles.controls}>
        <button type="button" className={styles.ctl} onClick={() => api.minimize()} title="Minimise" aria-label="Minimise"><Minus size={14} strokeWidth={1.5} /></button>
        <button type="button" className={styles.ctl} onClick={toggle} title={maximized ? 'Restore' : 'Maximise'} aria-label={maximized ? 'Restore' : 'Maximise'}>
          {maximized ? <Copy size={12} strokeWidth={1.5} className={styles.restore} /> : <Square size={12} strokeWidth={1.5} />}
        </button>
        <button type="button" className={`${styles.ctl} ${styles.close}`} onClick={() => api.close()} title="Close" aria-label="Close"><X size={15} strokeWidth={1.5} /></button>
      </div>
    </header>
  )
}
