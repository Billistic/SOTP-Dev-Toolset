import { useEffect, useState } from 'react'
import { Info, Scale } from 'lucide-react'
import { tokenToValue } from '@/utils/tree'
import { isEnter, isEscape } from '@/utils/keys'
import type { LayoutSlot } from '@/types/api'
import styles from './LevelsRow.module.css'

interface Props {
  slot: LayoutSlot                 // kind levels | cost | levelinc
  label: string
  onSet: (path: string, value: number) => void
  busy?: boolean
  balance?: boolean
}

const SUB_LABEL: Record<string, string> = { credits: 'credits', metal: 'metal', crystal: 'crystal', StartValue: 'start', ValueIncreasePerLevel: '+ per level' }

/** A small block of numbers on one row: Level:0..3, credits/metal/crystal or StartValue/ValueIncreasePerLevel. */
export function LevelsRow({ slot, label, onSet, busy, balance }: Props) {
  return (
    <div className={styles.row} data-balance={balance || undefined}>
      <label className={styles.label} title={`${slot.path}${slot.help ? `\n${slot.help}` : ''}`}>
        {label}{balance && <Scale size={11} className={styles.balanceTag} aria-label="Affects balance metrics" />}{slot.help && <Info size={11} className={styles.helpTag} />}
      </label>
      <div className={styles.cells}>
        {(slot.values ?? []).map((v) => (
          <span key={v.path} className={styles.cell} data-missing={!v.present || undefined}>
            <span className={styles.sub}>{SUB_LABEL[v.key] ?? v.key.replace(/^Level:/, 'L').replace(/:$/, '')}</span>
            {v.present ? <NumCell raw={v.raw!} busy={busy} onCommit={(n) => onSet(v.path, n)} /> : <span className={styles.absent}>–</span>}
          </span>
        ))}
        {(slot.unknown ?? []).map((u) => <span key={u.path} className={styles.extra} title="Not part of this block in the grammar">{u.key} {u.raw}</span>)}
      </div>
    </div>
  )
}

function NumCell({ raw, onCommit, busy }: { raw: string; onCommit: (n: number) => void; busy?: boolean }) {
  const initial = String(tokenToValue(raw) ?? '')
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])
  const dirty = draft !== initial
  const commit = () => {
    if (!dirty) return
    const n = Number(draft)
    if (Number.isNaN(n)) { setDraft(initial); return }
    onCommit(n)
  }
  return (
    <input className={styles.num} value={draft} disabled={busy} data-dirty={dirty || undefined} spellCheck={false}
           onChange={(e) => setDraft(e.target.value)} onBlur={commit}
           onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); commit() } if (isEscape(e)) setDraft(initial) }} />
  )
}
