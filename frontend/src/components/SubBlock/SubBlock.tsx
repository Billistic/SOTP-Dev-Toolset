import { useState } from 'react'
import { AlertTriangle, ChevronRight, Trash2 } from 'lucide-react'
import { BlockBody } from '@/components/BlockBody/BlockBody'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import { tileStats, type BlockItem } from '@/utils/formPlan'
import type { EditChange } from '@/types/api'
import styles from './SubBlock.module.css'

interface Props {
  item: BlockItem
  entityType: string
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
  depth: number
  removable?: boolean          // items of a repeated block (instantAction[1]...) can be removed whole
}

/** A nested block inside a tile: collapsible header with the block's name, discriminator and problem count. */
export function SubBlock({ item, entityType, onEdit, busy, depth, removable }: Props) {
  const [open, setOpen] = useState(depth <= 2)
  const [confirm, setConfirm] = useState(false)
  const stats = tileStats(item.items)
  const sec = item.section
  return (
    <div className={styles.block} data-depth={Math.min(depth, 4)}>
      <div className={styles.head}>
        <button type="button" className={styles.toggle} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ChevronRight size={13} className={styles.chev} data-open={open || undefined} />
          <span className={styles.title}>{item.label}{item.index !== undefined && <span className={styles.index}>#{item.index}</span>}</span>
          {sec.subtitle && <span className={styles.sub}>{sec.subtitle}</span>}
          <span className={styles.meta}>
            {stats.warn > 0 && <span className={styles.warn} title={`${stats.warn} problem(s) inside`}><AlertTriangle size={11} />{stats.warn}</span>}
            <span>{stats.present}</span>
          </span>
        </button>
        {removable && <button type="button" className={styles.remove} disabled={busy} onClick={() => setConfirm(true)} title="Remove this block"><Trash2 size={12} /></button>}
      </div>
      {open && <div className={styles.body}><BlockBody items={item.items} entityType={entityType} onEdit={onEdit} busy={busy} depth={depth} /></div>}
      {confirm && (
        <ConfirmDialog title="Remove block" confirmLabel="Remove" danger onCancel={() => setConfirm(false)}
                       onConfirm={() => { onEdit([{ op: 'remove', path: sec.path }]); setConfirm(false) }}>
          <p>Remove <code>{sec.path}</code>{sec.subtitle ? ` (${sec.subtitle})` : ''} and everything inside it?</p>
          <p className="muted">The count above it is re-synced on write; Revert restores the file if needed.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
