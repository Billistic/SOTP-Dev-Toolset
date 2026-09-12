import type { ReactNode } from 'react'
import { Modal } from '@/components/Modal/Modal'
import styles from './ConfirmDialog.module.css'

interface Props {
  title: string
  confirmLabel?: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children: ReactNode
}

/** Yes/no dialog for actions that are hard to undo. */
export function ConfirmDialog({ title, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel, children }: Props) {
  const footer = (
    <>
      <span className={styles.spacer} />
      <button type="button" className="btn sm" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className={`btn sm ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy} autoFocus>{confirmLabel}</button>
    </>
  )
  return <Modal title={title} onClose={onCancel} footer={footer} width={460}><div className={styles.body}>{children}</div></Modal>
}
