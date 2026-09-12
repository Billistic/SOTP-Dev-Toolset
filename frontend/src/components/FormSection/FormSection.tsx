import { ChevronRight, Scale } from 'lucide-react'
import type { ReactNode } from 'react'
import styles from './FormSection.module.css'

interface Props {
  title: string
  count: number               // fields inside
  balanceCount?: number       // how many of them feed the balance metrics
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}

/** One collapsible tile of a form; the body is unmounted while collapsed so big forms stay light. */
export function FormSection({ title, count, balanceCount = 0, collapsed, onToggle, children }: Props) {
  return (
    <section className={styles.tile} data-collapsed={collapsed || undefined}>
      <button type="button" className={styles.header} onClick={onToggle} aria-expanded={!collapsed}>
        <ChevronRight size={14} className={styles.chevron} />
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>
          {balanceCount > 0 && <span className={styles.balance} title={`${balanceCount} balance-relevant field(s)`}><Scale size={11} />{balanceCount}</span>}
          <span>{count}</span>
        </span>
      </button>
      {!collapsed && <div className={styles.body}>{children}</div>}
    </section>
  )
}
