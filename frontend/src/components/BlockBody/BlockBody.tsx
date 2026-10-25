import { useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { FieldRow } from '@/components/FieldRow/FieldRow'
import { LevelsRow } from '@/components/LevelsRow/LevelsRow'
import { SubBlock } from '@/components/SubBlock/SubBlock'
import { useUiStore } from '@/store/useUiStore'
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
  parent?: string             // path of the block these rows belong to: free mode can add any key there
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*(:[A-Za-z0-9_]+)?$/

const SPEC_KIND: Record<string, FieldSpec['kind']> = { bool: 'bool', int: 'int', float: 'float', enum: 'enum', ref: 'ref', color: 'color', position: 'array', coordinate: 'array', orientation: 'array', string: 'string' }

/**
 * Renders the rows of one block (or one curated group): present fields editable, missing required ones
 * flagged with "add", missing optional ones behind a toggle, nested blocks as collapsible sub-blocks,
 * and keys the grammar does not know marked and removable.
 */
export function BlockBody({ items, entityType, onEdit, busy, depth = 0, removableBlocks, parent }: Props) {
  const free = useUiStore((s) => s.formMode === 'free')
  const [showOptional, setShowOptional] = useState(false)
  const optional = items.filter((it): it is SlotItem => it.type === 'slot' && !it.slot.present && !it.slot.required && it.slot.kind !== 'count')
  const visible = items.filter((it) => it.type !== 'slot' || it.slot.present || it.slot.required || it.slot.kind === 'count' || showOptional)
  const set = (path: string) => (value: unknown) => onEdit([{ op: 'set', path, value }])
  // each option of a condition field implies its own fields: guided mode swaps them in with the value
  // (free mode, or a value that is not an option, just sets it)
  const choose = (slot: SlotItem['slot']) => (value: unknown) =>
    onEdit([{ op: !free && slot.options?.includes(String(value)) ? 'switch' : 'set', path: slot.path, value }])
  // rows already in the file, in order: where a free-form field can go
  const present = items.flatMap((it) =>
    it.type === 'block' ? [{ path: it.section.path, label: it.label }]
    : it.type === 'unknown' ? [{ path: it.u.path, label: it.u.key }]
    : it.slot.present && !it.slot.readonly ? [{ path: it.slot.path, label: it.label }] : [])

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
          <FieldRow key={slot.path} path={slot.path} raw={slot.raw ?? undefined} entityType={entityType} busy={busy} onCommit={slot.switch ? choose(slot) : set(slot.path)}
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
      {free && parent !== undefined && <CustomField parent={parent} present={present} onEdit={onEdit} busy={busy} />}
    </div>
  )
}

/** Free mode: any key and raw value, placed after a chosen row of this block (outside the definition, so it is flagged as unknown). */
function CustomField({ parent, present, onEdit, busy }: { parent: string; present: { path: string; label: string }[]; onEdit: (c: EditChange[]) => void; busy?: boolean }) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [after, setAfter] = useState<string | null>(null)
  const at = after !== null && present.some((p) => p.path === after) ? after : present[present.length - 1]?.path ?? ''
  const keyOk = KEY_RE.test(key.trim())
  const add = () => {
    if (!keyOk || busy) return
    onEdit([{ op: 'insertText', parent, text: `${key.trim()} ${value.trim() || '""'}`, after: at || null }])
    setKey('')
    setValue('')
  }
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') add() }
  return (
    <div className={styles.custom}>
      <input type="text" className={styles.customKey} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={enter}
             placeholder="any key" spellCheck={false} aria-label="Field key" aria-invalid={key !== '' && !keyOk} />
      <input type="text" className={styles.customValue} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={enter}
             placeholder='value as in the file: "Name", 5, 0.5, TRUE' spellCheck={false} aria-label="Field value" />
      {present.length > 0 && (
        <select className={styles.customAfter} value={at} onChange={(e) => setAfter(e.target.value)} aria-label="Insert after" title="Insert after">
          {present.map((p) => <option key={p.path} value={p.path}>after {p.label}</option>)}
        </select>
      )}
      <button type="button" className={styles.add} disabled={!keyOk || busy} onClick={add} title="Add this field (not in the definition: it will be flagged as unknown)">
        <Plus size={12} /> field
      </button>
    </div>
  )
}
