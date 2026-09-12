import { useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import { childPath, tokenToValue } from '@/utils/tree'
import type { EditChange, TreeNode } from '@/types/api'
import styles from './SoundListEditor.module.css'

interface Props {
  label: string
  path: string             // path of the list block, e.g. Weapon[0].WeaponEffects.muzzleSounds
  block: TreeNode | undefined
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

/** A ``soundCount`` + ``sound`` list: pick, replace, remove; the count is re-synced by the backend. */
export function SoundListEditor({ label, path, block, onEdit, busy }: Props) {
  const [picking, setPicking] = useState<null | { path: string; value: string } | 'new'>(null)
  const sounds = (block?.c ?? []).filter((n) => n.k === 'sound')

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.count}>{sounds.length}</span>
        <span className={styles.spacer} />
        {block ? (
          <button type="button" className={styles.add} disabled={busy} onClick={() => setPicking('new')}><Plus size={12} /> Add sound</button>
        ) : <span className={styles.missing}>block not present</span>}
      </div>
      {sounds.length > 0 && (
        <ul className={styles.list}>
          {sounds.map((n) => {
            const p = childPath(path, block!.c!, n)
            const value = String(tokenToValue(n.v) ?? '')
            return (
              <li key={p} className={styles.row}>
                <code className={styles.value} title={p}>{value || <span className={styles.missing}>(empty)</span>}</code>
                <button type="button" className={styles.icon} title="Choose sound" disabled={busy} onClick={() => setPicking({ path: p, value })}><FolderOpen size={12} /></button>
                <button type="button" className={styles.icon} title="Remove" disabled={busy} onClick={() => onEdit([{ op: 'remove', path: p }])}><Trash2 size={12} /></button>
              </li>
            )
          })}
        </ul>
      )}
      {picking && (
        <AssetPicker kind="sound" value={picking === 'new' ? '' : picking.value} fieldKey="sound" onClose={() => setPicking(null)}
                     onPick={(v) => onEdit(picking === 'new'
                       ? [{ op: 'add', parent: path, key: 'sound', value: v }]
                       : [{ op: 'set', path: picking.path, value: v }])} />
      )}
    </div>
  )
}
