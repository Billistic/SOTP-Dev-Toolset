import { useState } from 'react'
import { AlertTriangle, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { FieldRow } from '@/components/FieldRow/FieldRow'
import { LevelsRow } from '@/components/LevelsRow/LevelsRow'
import { SubBlock } from '@/components/SubBlock/SubBlock'
import type { Item, SlotItem } from '@/utils/formPlan'
import type { EditChange, FieldSpec } from '@/types/api'
import styles from './BlockBody.module.css'

interface Props {
  items: Item[]
  entityType: string
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
  depth?: number
  removableBlocks?: boolean   // items of a repeated block can be removed whole
}

const SPEC_KIND: Record<string, FieldSpec['kind']> = { bool: 'bool', int: 'int', float: 'float', enum: 'enum', ref: 'ref', color: 'color', position: 'array', coordinate: 'array', orientation: 'array', string: 'string' }

/**
 * Renders the rows of one block (or one curated group): present fields editable, missing required ones
 * flagged with "add", missing optional ones behind a toggle, nested blocks as collapsible sub-blocks,
 * and keys the grammar does not know marked and removable.
 */
export function BlockBody({ items, entityType, onEdit, busy, depth = 0, removableBlocks }: Props) {
  const [showOptional, setShowOptional] = useState(false)
  const optional = items.filter((it): it is SlotItem => it.type === 'slot' && !it.slot.present && !it.slot.required && it.slot.kind !== 'count')
  const visible = items.filter((it) => it.type !== 'slot' || it.slot.present || it.slot.required || it.slot.kind === 'count' || showOptional)
  const set = (path: string) => (value: unknown) => onEdit([{ op: 'set', path, value }])

  return (
    <div className={styles.body}>
      {visible.map((it) => {
        if (it.type === 'block') {
          return <SubBlock key={it.section.path} item={it} entityType={entityType} onEdit={onEdit} busy={busy} depth={depth + 1} removable={removableBlocks} />
        }
        if (it.type === 'unknown') {
          const u = it.u
          const remove = <button type="button" className={styles.remove} disabled={busy} onClick={() => onEdit([{ op: 'remove', path: u.path }])} title="Remove this key (the game ignores it anyway)"><Trash2 size={12} /></button>
          if (u.block) {
            return (
              <div key={u.path} className={styles.static} data-unknown="">
                <span className={styles.staticLabel} title="Not in the Rebellion grammar for this block"><AlertTriangle size={11} />{u.key}</span>
                <span className={styles.muted}>block · {u.children} value{u.children === 1 ? '' : 's'}</span>{remove}
              </div>
            )
          }
          return (
            <FieldRow key={u.path} path={u.path} raw={u.raw ?? undefined} entityType={entityType} busy={busy} onCommit={set(u.path)} unknown trailing={remove}
                      spec={{ label: u.key, kind: 'string', ref: null, enum: null, unit: null, help: 'Not in the Rebellion grammar for this block; the game ignores it.', balance: false }} />
          )
        }
        const { slot, spec, label } = it
        if (slot.readonly) {
          return <div key={slot.path} className={styles.static}><span className={styles.staticLabel}>{label}</span><code>{slot.raw}</code></div>
        }
        if (!slot.present) {
          return (
            <div key={slot.path} className={styles.unset} data-required={slot.required || undefined}>
              <span className={styles.unsetLabel} title={`${slot.path}${slot.help ? `\n${slot.help}` : ''}`}>
                {slot.required && <AlertTriangle size={11} />}{label}
                <span className={styles.kind}>{slot.kind === 'section' ? 'block' : slot.kind}{slot.required ? ' · required' : ''}</span>
              </span>
              {it.add && slot.template && (
                <button type="button" className={styles.add} disabled={busy} title={`Insert:\n${slot.template}`}
                        onClick={() => onEdit([{ op: 'insertText', parent: it.add!.parent, text: slot.template!, after: it.add!.after }])}>
                  <Plus size={12} /> add
                </button>
              )}
            </div>
          )
        }
        if (slot.kind === 'count') {
          const n = slot.occurrences ?? 0
          return (
            <div key={slot.path} className={styles.count} data-mismatch={slot.mismatch || undefined}>
              <span className={styles.countLabel} title={slot.path}>{label}</span>
              <span className={styles.countValue}>
                {slot.raw}<span className={styles.muted}> · {n} present{slot.limit ? ` · max ${slot.limit}` : ''}</span>
                {slot.mismatch && <span className={styles.warn} title="The count does not match the items that follow; it is re-synced on write"><AlertTriangle size={11} /> mismatch</span>}
              </span>
              {it.addItem && slot.itemTemplate && (!slot.limit || n < slot.limit) && (
                <button type="button" className={styles.add} disabled={busy} title={`Append:\n${slot.itemTemplate}`}
                        onClick={() => onEdit([{ op: 'insertText', parent: it.addItem!.parent, text: slot.itemTemplate!, afterLast: it.addItem!.afterLast }])}>
                  <Plus size={12} /> {slot.item}
                </button>
              )}
            </div>
          )
        }
        if (slot.kind === 'levels' || slot.kind === 'cost' || slot.kind === 'levelinc') {
          return <LevelsRow key={slot.path} slot={slot} label={label} balance={spec?.balance} busy={busy} onSet={(p, v) => onEdit([{ op: 'set', path: p, value: v }])} />
        }
        if (slot.kind === 'section' || slot.block) {
          return <div key={slot.path} className={styles.static}><span className={styles.staticLabel}>{label}</span><span className={styles.warn}>block where a value was expected - see the Tree view</span></div>
        }
        const help = [spec?.help, slot.help, slot.switch ? 'Its value decides which fields follow.' : null, slot.legacy ? 'Legacy field (pre-Rebellion).' : null].filter(Boolean).join('\n') || null
        return (
          <FieldRow key={slot.path} path={slot.path} raw={slot.raw ?? undefined} entityType={entityType} busy={busy} onCommit={set(slot.path)}
                    options={slot.options ?? undefined} invalid={slot.invalid} strict={slot.kind === 'int' || slot.kind === 'float' ? slot.kind : undefined}
                    spec={{ label: slot.switch ? `${label} ▸` : label, kind: spec?.kind === 'stat' ? SPEC_KIND[slot.kind] ?? 'float' : spec?.kind ?? SPEC_KIND[slot.kind] ?? 'string',
                            ref: slot.ref ?? spec?.ref ?? null, enum: slot.enum ?? spec?.enum ?? null, unit: spec?.unit ?? null, help, balance: spec?.balance ?? false }} />
        )
      })}
      {optional.length > 0 && (
        <button type="button" className={styles.more} onClick={() => setShowOptional((v) => !v)} aria-expanded={showOptional}>
          <ChevronRight size={12} className={styles.chev} data-open={showOptional || undefined} />
          {showOptional ? 'Hide' : 'Show'} {optional.length} optional field{optional.length === 1 ? '' : 's'} not set
        </button>
      )}
    </div>
  )
}
