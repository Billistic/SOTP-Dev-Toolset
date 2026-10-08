import { useEffect, useRef } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { useDesktop } from '@/hooks/useDesktop'
import { useProject } from '@/hooks/useProject'
import { useWindowStore } from '@/store/useWindowStore'
import { Emblem } from '@/components/Brand/Brand'
import styles from './TitleBar.module.css'

/**
 * Custom caption for the frameless desktop window (Discord / Claude Desktop style): brand on the
 * left, a drag region, and native-feeling minimise / maximise / close. Renders nothing in a browser.
 */
export function TitleBar() {
  const api = useDesktop()
  const { project } = useProject()
  const maximized = useWindowStore((s) => s.maximized)
  const setMaximized = useWindowStore((s) => s.setMaximized)
  useEffect(() => { api?.is_maximized().then(setMaximized).catch(() => undefined) }, [api, setMaximized])
  useEffect(() => {   // the shell reports Win+Up, snap and drag-to-restore so the buttons and edges stay right
    const on = (e: Event) => setMaximized(Boolean((e as CustomEvent<boolean>).detail))
    window.addEventListener('sotp-window-state', on)
    return () => window.removeEventListener('sotp-window-state', on)
  }, [setMaximized])
  const lastDown = useRef(0)
  if (!api) return null
  const toggle = () => api.toggle_maximize().then(setMaximized).catch(() => undefined)
  // Windows' move loop swallows the second click, so a double-click is recognised here instead of via dblclick
  const onCaptionDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const now = performance.now()
    if (now - lastDown.current < 400) { lastDown.current = 0; void toggle(); return }
    lastDown.current = now
    void api.start_drag()
  }

  return (
    <header className={styles.bar}>
      <div className={styles.brand} onPointerDown={onCaptionDown}>
        <Emblem size={16} />
        <span className={styles.title}>SOTP Dev Env</span>
        {project && <span className={styles.project}>{project.name}</span>}
      </div>
      <div className={styles.drag} onPointerDown={onCaptionDown} />
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
