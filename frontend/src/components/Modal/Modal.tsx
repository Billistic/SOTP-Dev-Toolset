import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import styles from './Modal.module.css'

interface Props {
  title: string
  onClose: () => void
  width?: number
  footer?: ReactNode
  children: ReactNode
}

/** Generic dialog shell: backdrop, title bar, body, optional footer. Escape / backdrop click close it. */
export function Modal({ title, onClose, width = 520, footer, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div className={styles.dialog} style={{ width }} role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <h3 className={styles.title}>{title}</h3>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close"><X size={15} /></button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.foot}>{footer}</footer>}
      </div>
    </div>
  )
}
