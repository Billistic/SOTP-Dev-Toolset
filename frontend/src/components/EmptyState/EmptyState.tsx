import type { ReactNode } from 'react'
import styles from './EmptyState.module.css'

export function EmptyState({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className={styles.root}>
      <p className={styles.title}>{title}</p>
      {detail && <p className={styles.detail}>{detail}</p>}
      {children}
    </div>
  )
}
