import { useRef } from 'react'
import { useDesktop } from '@/hooks/useDesktop'
import { useWindowStore } from '@/store/useWindowStore'
import styles from './WindowEdges.module.css'

const EDGES = ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const

/**
 * Invisible resize handles around the frameless desktop window. Pointer deltas (in physical pixels)
 * are streamed to the shell, which moves the native window - the same technique pywebview uses for dragging.
 */
export function WindowEdges() {
  const api = useDesktop()
  const maximized = useWindowStore((s) => s.maximized)
  const drag = useRef<{ x: number; y: number; frame: number; dx: number; dy: number; ready: boolean } | null>(null)
  if (!api || maximized) return null

  const onDown = (edge: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)   // synchronously: currentTarget is gone once the handler returns
    const d = { x: e.screenX, y: e.screenY, frame: 0, dx: 0, dy: 0, ready: false }
    drag.current = d
    api.begin_resize(edge).then((ok) => { if (ok) d.ready = true; else if (drag.current === d) drag.current = null })
  }
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !d.ready) return
    const scale = window.devicePixelRatio || 1
    d.dx = (e.screenX - d.x) * scale
    d.dy = (e.screenY - d.y) * scale
    if (!d.frame) d.frame = requestAnimationFrame(() => { d.frame = 0; void api.drag_resize(d.dx, d.dy, scale) })
  }
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    drag.current = null
    void api.end_resize()
  }

  return (
    <>
      {EDGES.map((edge) => (
        <div key={edge} className={styles.edge} data-edge={edge}
             onPointerDown={onDown(edge)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      ))}
    </>
  )
}
