import { useDesktop } from '@/hooks/useDesktop'
import { useWindowStore } from '@/store/useWindowStore'
import styles from './WindowEdges.module.css'

const EDGES = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

/**
 * Invisible resize handles around the frameless desktop window. Pressing one hands the button to Windows'
 * own resize loop (WM_NCLBUTTONDOWN + HTLEFT ...), so the minimum size, snapping and display scaling are native.
 */
export function WindowEdges() {
  const api = useDesktop()
  const maximized = useWindowStore((s) => s.maximized)
  if (!api || maximized) return null

  const onDown = (edge: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    void api.start_resize(edge)
  }

  return (
    <>
      {EDGES.map((edge) => <div key={edge} className={styles.edge} data-edge={edge} onPointerDown={onDown(edge)} />)}
    </>
  )
}
