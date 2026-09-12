import { X } from 'lucide-react'
import { useToastStore } from '@/store/useToastStore'
import styles from './ToastStack.module.css'

export function ToastStack() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  if (!toasts.length) return null
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} data-kind={t.kind}>
          <span className={styles.msg}>{t.message}</span>
          <button className={styles.close} onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={13} /></button>
        </div>
      ))}
    </div>
  )
}
