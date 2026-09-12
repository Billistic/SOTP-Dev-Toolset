import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronsDownUp, ChevronsUpDown, Plus, Table2 } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { WeaponTable } from '@/components/WeaponTable/WeaponTable'
import { WeaponCard } from '@/components/WeaponCard/WeaponCard'
import { findNode } from '@/utils/tree'
import type { EditChange, EntityDetail } from '@/types/api'
import styles from './WeaponEditor.module.css'

interface Props {
  entity: EntityDetail
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

/** Weapons tab: comparison grid on top, one full editor card per weapon, add / reorder / remove. */
export function WeaponEditor({ entity, onEdit, busy }: Props) {
  const root = entity.tree.root
  const { data: schema } = useQuery({ queryKey: ['schema', 'weapon'], queryFn: catalogApi.weaponSchema, staleTime: Infinity })
  const blocks = useMemo(() => root.filter((n) => n.k === 'Weapon'), [root])
  const [showGrid, setShowGrid] = useState(true)
  const [open, setOpen] = useState<Set<number>>(() => new Set(blocks.length === 1 ? [0] : []))
  const rows = useMemo(() => new Map(entity.weapons.map((w) => [w.weapon_index, w])), [entity.weapons])
  const hasCounter = !!findNode(root, 'NumWeapons')

  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n })
  const allOpen = blocks.length > 0 && blocks.every((_, i) => open.has(i))

  const addWeapon = (type: string) => {
    if (!schema) return
    // weapons follow NumWeapons in the file; append after the last weapon (or the counter itself)
    const after = blocks.length ? `Weapon[${blocks.length - 1}]` : hasCounter ? 'NumWeapons' : null
    onEdit([{ op: 'insertText', parent: '', text: schema.templates[type], after }])
    setOpen((s) => new Set([...s, blocks.length]))
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button type="button" className={styles.toolBtn} data-active={showGrid || undefined} onClick={() => setShowGrid((v) => !v)} title="Show / hide the comparison grid">
          <Table2 size={13} /> Grid
        </button>
        <button type="button" className={styles.toolBtn} disabled={!blocks.length} onClick={() => setOpen(allOpen ? new Set() : new Set(blocks.map((_, i) => i)))}>
          {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}{allOpen ? 'Collapse all' : 'Expand all'}
        </button>
        <span className={styles.spacer} />
        <span className={styles.addLabel}><Plus size={13} /> Add weapon</span>
        {Object.keys(schema?.templates ?? {}).map((t) => (
          <button key={t} type="button" className="btn sm" disabled={busy || !schema} onClick={() => addWeapon(t)} title={`Insert a starter ${t} weapon`}>{t}</button>
        ))}
      </div>

      {showGrid && blocks.length > 0 && <WeaponTable entity={entity} onEdit={onEdit} busy={busy} />}

      {blocks.length === 0 && (
        <p className={styles.hint}>
          {hasCounter ? 'No weapons yet. Add a Projectile, Missile or Beam starter above and fill it in.' : 'This entity type does not carry weapons.'}
        </p>
      )}

      {schema && blocks.length > 0 && (
        <div className={styles.cards}>
          {blocks.map((_, i) => (
            <WeaponCard key={i} index={i} count={blocks.length} root={root} row={rows.get(i)} schema={schema} entityType={entity.entityType}
                        open={open.has(i)} onToggle={() => toggle(i)} onEdit={onEdit} busy={busy} />
          ))}
        </div>
      )}
    </div>
  )
}
