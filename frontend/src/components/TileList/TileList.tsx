import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import styles from './TileList.module.css'

export interface ListCard {
  key: string
  title: string
  warn?: number
  node: ReactNode
}

interface Props {
  cards: ListCard[]
  collapsed: string[]
  onExpand: (key: string) => void
}

/**
 * Tiles in one full-width column with a sticky jump list beside them (the Unreal Details panel idiom):
 * clicking a name expands that tile and scrolls to it; the tile at the top of the view is highlighted.
 */
export function TileList({ cards, collapsed, onExpand }: Props) {
  const refs = useRef(new Map<string, HTMLDivElement>())
  const visible = useRef(new Set<string>())
  const [active, setActive] = useState<string | null>(null)
  const keys = cards.map((c) => c.key).join('|')

  useEffect(() => {
    visible.current.clear()
    const order = keys.split('|')
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const key = (e.target as HTMLElement).dataset.tile!
        if (e.isIntersecting) visible.current.add(key)
        else visible.current.delete(key)
      }
      const top = order.find((k) => visible.current.has(k))
      if (top) setActive(top)
    }, { rootMargin: '0px 0px -65% 0px' })   // "at the top" = within the upper third of the view
    refs.current.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [keys])

  const jump = (key: string) => {
    if (collapsed.includes(key)) onExpand(key)
    setActive(key)
    requestAnimationFrame(() => refs.current.get(key)?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
  }

  return (
    <div className={styles.list}>
      <nav className={styles.jump} aria-label="Sections">
        {cards.map((c) => (
          <button key={c.key} type="button" className={styles.link} data-active={active === c.key || undefined}
                  data-collapsed={collapsed.includes(c.key) || undefined} onClick={() => jump(c.key)}>
            <span className={styles.name}>{c.title}</span>
            {!!c.warn && <AlertTriangle size={11} className={styles.warn} aria-label={`${c.warn} to look at`} />}
          </button>
        ))}
      </nav>
      <div className={styles.cards}>
        {cards.map((c) => (
          <div key={c.key} data-tile={c.key} className={styles.card}
               ref={(el) => { if (el) refs.current.set(c.key, el); else refs.current.delete(c.key) }}>
            {c.node}
          </div>
        ))}
      </div>
    </div>
  )
}
