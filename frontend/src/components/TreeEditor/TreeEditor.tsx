import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { childPath, isBlock, tokenKind, tokenToValue } from '@/utils/tree'
import { isEnter, isEscape } from '@/utils/keys'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import { PromptDialog } from '@/components/PromptDialog/PromptDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import type { EditChange, EntityDetail, TreeNode } from '@/types/api'
import styles from './TreeEditor.module.css'

interface Props {
  entity: EntityDetail
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*(:[0-9]+)?:?$/

/** Generic editor over the lossless tree: every key, in file order, inline-editable. */
export function TreeEditor({ entity, onEdit, busy }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<{ path: string; kind: string; value: string; key: string } | null>(null)
  const [adding, setAdding] = useState<{ parent: string; label: string } | null>(null)
  const [removing, setRemoving] = useState<{ path: string; key: string; count: number } | null>(null)
  const toggle = (p: string) => setCollapsed((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n })

  const renderNodes = (nodes: TreeNode[], parentPath: string, depth: number) =>
    nodes.map((n, i) => {
      const path = childPath(parentPath, nodes, n)
      const key = `${path}#${i}`
      if (isBlock(n)) {
        const open = !collapsed.has(path)
        return (
          <li key={key}>
            <div className={styles.row} style={{ paddingLeft: 8 + depth * 16 }}>
              <button className={styles.twisty} onClick={() => toggle(path)} aria-expanded={open}>
                {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <span className={styles.blockKey}>{n.k || '[ ]'}</span>
              <span className={styles.count}>{n.c?.length ?? 0}</span>
              <span className={styles.actions}>
                <button title="Add child key" onClick={() => setAdding({ parent: path, label: n.k })}><Plus size={12} /></button>
                <button title="Remove block" onClick={() => setRemoving({ path, key: n.k, count: n.c?.length ?? 0 })}><Trash2 size={12} /></button>
              </span>
            </div>
            {open && n.c && <ul>{renderNodes(n.c, path, depth + 1)}</ul>}
          </li>
        )
      }
      const refKind = entity.refKinds?.[path]
      return (
        <li key={key}>
          <div className={styles.row} style={{ paddingLeft: 26 + depth * 16 }}>
            <span className={styles.key} title={refKind ? `${path}\n${refKind} reference` : path} data-ref={refKind || undefined}>{n.k || '·'}</span>
            <ValueCell raw={n.v!} busy={busy} onCommit={(v) => onEdit([{ op: 'set', path, value: v }])} />
            {refKind && (
              <button className={styles.pick} title={`Choose ${refKind}`}
                      onClick={() => setPicker({ path, kind: refKind, value: String(tokenToValue(n.v) ?? ''), key: n.k })}><FolderOpen size={12} /></button>
            )}
            <span className={styles.actions}>
              <button title="Remove" onClick={() => onEdit([{ op: 'remove', path }])}><Trash2 size={12} /></button>
            </span>
          </div>
        </li>
      )
    })

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className="muted">{entity.tree.header.fmt}{entity.tree.header.archiveVersion ? ` · SinsArchiveVersion ${entity.tree.header.archiveVersion}` : ''}</span>
        <button className="btn sm" onClick={() => setAdding({ parent: '', label: '' })}><Plus size={12} /> Add key</button>
      </div>
      <ul className={styles.tree}>{renderNodes(entity.tree.root, '', 0)}</ul>
      {picker && (
        <AssetPicker kind={picker.kind} value={picker.value} fieldKey={picker.key}
                     onPick={(v) => onEdit([{ op: 'set', path: picker.path, value: v }])} onClose={() => setPicker(null)} />
      )}
      {adding && (
        <PromptDialog
          title={adding.label ? `Add key inside ${adding.label}` : 'Add top-level key'} submitLabel="Add" busy={busy}
          fields={[
            { name: 'key', label: 'Key', placeholder: 'e.g. MaxHullPoints or Weapon', mono: true, required: true,
              validate: (v) => (KEY_RE.test(v.trim()) ? null : 'letters, digits and _ only (optionally :index)') },
            { name: 'value', label: 'Value', placeholder: 'leave empty to add a block', mono: true,
              hint: 'Numbers and TRUE / FALSE are typed automatically; anything else is written as a quoted string.' },
          ]}
          preview={(v) => v.key.trim() ? `${v.key.trim()}${v.value.trim() === '' ? '' : ' ' + previewToken(v.value.trim())}` : null}
          onSubmit={(v) => { onEdit([{ op: 'add', parent: adding.parent, key: v.key, ...(v.value === '' ? {} : { value: coerce(v.value) }) }]); setAdding(null) }}
          onClose={() => setAdding(null)}
        />
      )}
      {removing && (
        <ConfirmDialog title="Remove block" confirmLabel="Remove" danger onCancel={() => setRemoving(null)}
                       onConfirm={() => { onEdit([{ op: 'remove', path: removing.path }]); setRemoving(null) }}>
          <p>Remove <code>{removing.key}</code> and its {removing.count} child value{removing.count === 1 ? '' : 's'}?</p>
          <p className="muted">Counts such as NumWeapons are re-synced on write; Revert restores the file if needed.</p>
        </ConfirmDialog>
      )}
    </div>
  )
}

function coerce(text: string): unknown {
  if (text === 'TRUE') return true
  if (text === 'FALSE') return false
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text)
  return text
}

/** How the value will appear in the file, for the dialog's preview line. */
function previewToken(text: string): string {
  const v = coerce(text)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return String(v)
  return `"${text}"`
}

function ValueCell({ raw, onCommit, busy }: { raw: string; onCommit: (v: unknown) => void; busy?: boolean }) {
  const kind = tokenKind(raw)
  const initial = tokenToValue(raw)
  const [draft, setDraft] = useState(initial === null ? '' : String(initial))
  useEffect(() => { setDraft(initial === null ? '' : String(initial)) }, [raw]) // eslint-disable-line react-hooks/exhaustive-deps -- picker / undo / server edits land here
  const dirty = draft !== String(initial)
  const commit = () => {
    if (!dirty) return
    if (kind === 'int' || kind === 'float') {
      const n = Number(draft)
      if (Number.isNaN(n)) return setDraft(String(initial))
      onCommit(n)
    } else if (kind === 'array') {
      const nums = draft.replace(/[[\],]/g, ' ').trim().split(/\s+/).map(Number)
      if (nums.some(Number.isNaN)) return setDraft(String(initial))
      onCommit(nums)
    } else onCommit(draft)
  }
  if (kind === 'bool') {
    return <input type="checkbox" checked={draft === 'true'} disabled={busy} onChange={(e) => { setDraft(String(e.target.checked)); onCommit(e.target.checked) }} />
  }
  return (
    <input className={styles.value} data-kind={kind} data-dirty={dirty || undefined} value={draft} disabled={busy} spellCheck={false}
           onChange={(e) => setDraft(e.target.value)} onBlur={commit}
           onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); commit() } if (isEscape(e)) setDraft(String(initial)) }} />
  )
}
