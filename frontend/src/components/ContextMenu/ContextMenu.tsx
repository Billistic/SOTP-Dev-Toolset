import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from './ContextMenu.module.css'

export interface MenuItem {
  label: string
  icon?: ReactNode
  hint?: string
  onClick: () => void
}

interface Props {
  x: number
  y: number
  title?: string
  items: MenuItem[]
  onClose: () => void
}

/** Small floating menu at a screen point; closes on outside click, Escape or after an item runs. Kept on screen. */
export function ContextMenu({ x, y, title, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) })
  }, [x, y])
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key) }
  }, [onClose])
  return (
    <div ref={ref} className={styles.menu} style={{ left: pos.x, top: pos.y }} role="menu">
      {title && <div className={styles.title}>{title}</div>}
      {items.map((it) => (
        <button key={it.label} type="button" role="menuitem" className={styles.item} onClick={() => { it.onClick(); onClose() }}>
          {it.icon && <span className={styles.icon}>{it.icon}</span>}
          <span className={styles.label}>{it.label}</span>
          {it.hint && <span className={styles.hint}>{it.hint}</span>}
        </button>
      ))}
    </div>
  )
}
