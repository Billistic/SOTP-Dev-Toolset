import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import styles from './TileStack.module.css'

export interface StackCard {
  key: string
  weight: number      // estimated rows when expanded: used until the tile has been measured
  node: ReactNode
}

interface Props {
  cards: StackCard[]
  collapsed: string[] // collapsed tiles keep the height they were last measured at (or their estimate)
  minColumn?: number  // px; as many columns as fit at this width
  gap?: number
}

const ROW_PX = 30
const HEADER_PX = 44

/**
 * Tiles in independent columns (masonry): each tile goes to the column that is shortest so far, so a short
 * tile never leaves a gap beside a tall one.  Tiles are placed by their expanded height, measured right after
 * the first render (before paint), and the arrangement then stays put until the set of tiles or the number of
 * columns changes - collapsing, expanding or editing a tile never moves the others.
 */
export function TileStack({ cards, collapsed, minColumn = 420, gap = 20 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [count, setCount] = useState(1)
  const [settled, setSettled] = useState('')
  const sig = cards.map((c) => c.key).join('|')
  const id = `${count}#${sig}`

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => setCount(Math.max(1, Math.floor((el.clientWidth + gap) / (minColumn + gap))))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [minColumn, gap])

  // measure every expanded tile; the first pass for a new arrangement re-places with real heights
  useLayoutEffect(() => {
    ref.current?.querySelectorAll<HTMLElement>('[data-tile]').forEach((el) => {
      if (!collapsed.includes(el.dataset.tile!)) heights.current.set(el.dataset.tile!, el.offsetHeight)
    })
    if (settled !== id) setSettled(id)
  })

  const weights = new Map(cards.map((c) => [c.key, c.weight]))
  const columns = useMemo(() => {
    const cols: string[][] = Array.from({ length: count }, () => [])
    const totals = new Array<number>(count).fill(0)
    for (const key of sig ? sig.split('|') : []) {
      const i = totals.indexOf(Math.min(...totals))
      cols[i].push(key)
      totals[i] += (heights.current.get(key) ?? HEADER_PX + (weights.get(key) ?? 1) * ROW_PX) + 12   // column gap
    }
    return cols
  }, [sig, count, settled])   // eslint-disable-line react-hooks/exhaustive-deps

  const byKey = new Map(cards.map((c) => [c.key, c]))
  return (
    <div ref={ref} className={styles.stack} style={{ gap }}>
      {columns.map((col, i) => (
        <div key={i} className={styles.column}>
          {col.map((key) => <div key={key} data-tile={key}>{byKey.get(key)?.node}</div>)}
        </div>
      ))}
    </div>
  )
}
