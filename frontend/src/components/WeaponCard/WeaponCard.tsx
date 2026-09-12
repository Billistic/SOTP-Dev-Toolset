import { ArrowDown, ArrowUp, ChevronRight, Copy, Trash2 } from 'lucide-react'
import { FieldRow } from '@/components/FieldRow/FieldRow'
import { SoundListEditor } from '@/components/SoundListEditor/SoundListEditor'
import { findNode, isBlock, tokenToValue } from '@/utils/tree'
import { fmtNum } from '@/utils/format'
import type { EditChange, FieldSpec, TreeNode, WeaponRow, WeaponSchema } from '@/types/api'
import styles from './WeaponCard.module.css'

interface Props {
  index: number
  count: number
  root: TreeNode[]
  row?: WeaponRow            // derived stats for the header (may lag one edit behind)
  schema: WeaponSchema
  entityType: string
  open: boolean
  onToggle: () => void
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

const GROUPS = ['Identity', 'Damage', 'Range & timing', 'Effects']

/** One weapon block: every field grouped, sound lists, and move / duplicate / remove. */
export function WeaponCard({ index, count, root, row, schema, entityType, open, onToggle, onEdit, busy }: Props) {
  const base = `Weapon[${index}]`
  const weaponType = String(findNode(root, `${base}.WeaponType`)?.v ?? '').replace(/"/g, '')
  const applies = (spec: { when?: string | null }) => !spec.when || spec.when === weaponType
  const valueOf = (spec: FieldSpec) => {
    const n = findNode(root, `${base}.${spec.path}`)
    return n && !isBlock(n) ? n.v : undefined
  }
  const attack = String(tokenToValue(findNode(root, `${base}.damageEnums.AttackType`)?.v) ?? '')

  return (
    <section className={styles.card} data-open={open || undefined}>
      <header className={styles.head}>
        <button type="button" className={styles.toggle} onClick={onToggle} aria-expanded={open}>
          <ChevronRight size={14} className={styles.chevron} />
          <span className={styles.index}>#{index}</span>
          <span className={styles.type}>{weaponType || 'weapon'}</span>
          {attack && <span className={styles.chip}>{attack}</span>}
          {row && <span className={styles.stat}>DPS <strong>{fmtNum(row.dps_best_bank)}</strong></span>}
          {row && row.range != null && <span className={styles.stat}>range <strong>{fmtNum(row.range)}</strong></span>}
          {row?.muzzle_effect && <span className={styles.fx} title={row.muzzle_effect}>{row.muzzle_effect}</span>}
        </button>
        <span className={styles.actions}>
          <button type="button" title="Move up" disabled={busy || index === 0} onClick={() => onEdit([{ op: 'move', path: base, offset: -1 }])}><ArrowUp size={13} /></button>
          <button type="button" title="Move down" disabled={busy || index === count - 1} onClick={() => onEdit([{ op: 'move', path: base, offset: 1 }])}><ArrowDown size={13} /></button>
          <button type="button" title="Duplicate weapon" disabled={busy} onClick={() => onEdit([{ op: 'clone', path: base }])}><Copy size={13} /></button>
          <button type="button" title="Remove weapon" disabled={busy} className={styles.danger}
                  onClick={() => { if (window.confirm(`Remove weapon #${index} (${weaponType})?`)) onEdit([{ op: 'remove', path: base }]) }}><Trash2 size={13} /></button>
        </span>
      </header>
      {open && (
        <div className={styles.body}>
          {GROUPS.map((g) => {
            const fields = schema.fields.filter((f) => f.group === g && applies(f))
            if (!fields.length) return null
            return (
              <div key={g} className={styles.group}>
                <h4 className={styles.groupTitle}>{g}</h4>
                {fields.map((f) => (
                  <FieldRow key={f.path} spec={f} path={`${base}.${f.path}`} raw={valueOf(f)} entityType={entityType}
                            onCommit={(v) => onEdit([{ op: 'set', path: `${base}.${f.path}`, value: v }])} busy={busy} />
                ))}
              </div>
            )
          })}
          <div className={styles.group}>
            <h4 className={styles.groupTitle}>Sounds</h4>
            <div className={styles.sounds}>
              {schema.soundLists.filter(applies).map((l) => (
                <SoundListEditor key={l.key} label={l.label} path={`${base}.WeaponEffects.${l.key}`}
                                 block={findNode(root, `${base}.WeaponEffects.${l.key}`)} onEdit={onEdit} busy={busy} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
