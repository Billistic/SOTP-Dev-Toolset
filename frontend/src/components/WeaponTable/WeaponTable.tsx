import { useState } from 'react'
import { fmtNum } from '@/utils/format'
import { isEnter, isEscape } from '@/utils/keys'
import type { EditChange, EntityDetail, WeaponRow } from '@/types/api'
import styles from './WeaponTable.module.css'

interface Props {
  entity: EntityDetail
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

const BANKS = ['FRONT', 'BACK', 'LEFT', 'RIGHT'] as const
const bankField = (b: (typeof BANKS)[number]) => `damage_${b.toLowerCase()}` as keyof WeaponRow

/** Per-weapon stats with inline editing of the damage / timing knobs. */
export function WeaponTable({ entity, onEdit, busy }: Props) {
  const weapons = entity.weapons
  const totalDps = weapons.reduce((n, w) => n + w.dps_best_bank, 0)
  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <span><strong>{weapons.length}</strong> weapons</span>
        <span>best-bank DPS <strong>{fmtNum(totalDps)}</strong></span>
        <span>all banks <strong>{fmtNum(weapons.reduce((n, w) => n + w.dps_all_banks, 0))}</strong></span>
        <span>anti-fighter <strong>{fmtNum(weapons.filter((w) => w.can_fire_at_fighter).reduce((n, w) => n + w.dps_best_bank, 0))}</strong></span>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th><th>Type</th><th>Attack</th><th>Class</th><th>Dmg type</th>
            {BANKS.map((b) => <th key={b} className={styles.num}>{b[0] + b.slice(1).toLowerCase()}</th>)}
            <th className={styles.num}>Cooldown</th><th className={styles.num}>Burst</th><th className={styles.num}>Range</th>
            <th className={styles.num}>DPS</th><th>AA</th><th>Muzzle FX</th>
          </tr>
        </thead>
        <tbody>
          {weapons.map((w) => (
            <tr key={w.weapon_index}>
              <td className="muted">{w.weapon_index}</td>
              <td>{w.weapon_type}</td>
              <td>{w.attack_type}</td>
              <td>{w.weapon_class}</td>
              <td>{w.damage_type}</td>
              {BANKS.map((b) => (
                <td key={b} className={styles.num}>
                  <Cell value={w[bankField(b)] as number} busy={busy} onCommit={(v) => onEdit([{ op: 'set', path: `Weapon[${w.weapon_index}].DamagePerBank:${b}`, value: v }])} />
                </td>
              ))}
              <td className={styles.num}><Cell value={w.cooldown ?? 0} busy={busy} onCommit={(v) => onEdit([{ op: 'set', path: `Weapon[${w.weapon_index}].PreBuffCooldownTime`, value: v }])} /></td>
              <td className={styles.num}><Cell value={w.burst_count} busy={busy} onCommit={(v) => onEdit([{ op: 'set', path: `Weapon[${w.weapon_index}].WeaponEffects.burstCount`, value: v }])} /></td>
              <td className={styles.num}><Cell value={w.range ?? 0} busy={busy} onCommit={(v) => onEdit([{ op: 'set', path: `Weapon[${w.weapon_index}].Range`, value: v }])} /></td>
              <td className={styles.num}><strong>{fmtNum(w.dps_best_bank)}</strong></td>
              <td>{w.can_fire_at_fighter ? '✓' : ''}</td>
              <td className={styles.fx} title={w.hit_effect ?? ''}>{w.muzzle_effect}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.note}>DPS = best bank × burst ÷ cooldown. Editing a cell writes the underlying field and recomputes.</p>
    </div>
  )
}

function Cell({ value, onCommit, busy }: { value: number; onCommit: (v: number) => void; busy?: boolean }) {
  const [draft, setDraft] = useState(String(value))
  const dirty = draft !== String(value)
  const commit = () => {
    if (!dirty) return
    const n = Number(draft)
    if (Number.isNaN(n)) setDraft(String(value))
    else onCommit(n)
  }
  return (
    <input className={styles.cell} data-dirty={dirty || undefined} value={draft} disabled={busy}
           onChange={(e) => setDraft(e.target.value)} onBlur={commit}
           onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); commit() } if (isEscape(e)) setDraft(String(value)) }} />
  )
}
