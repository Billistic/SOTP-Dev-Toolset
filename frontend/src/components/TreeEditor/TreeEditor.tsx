import { useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { childPath, isBlock, tokenKind, tokenToValue } from '@/utils/tree'
import { isEnter, isEscape } from '@/utils/keys'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import type { EditChange, EntityDetail, TreeNode } from '@/types/api'
import styles from './TreeEditor.module.css'

interface Props {
  entity: EntityDetail
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

/** Generic editor over the lossless tree: every key, in file order, inline-editable. */
export function TreeEditor({ entity, onEdit, busy }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<{ path: string; kind: string; value: string; key: string } | null>(null)
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
                <button title="Add child value" onClick={() => {
                  const k = window.prompt('New key name (inside ' + n.k + '):')
                  if (!k) return
                  const v = window.prompt('Value (leave empty for a block):') ?? ''
                  onEdit([{ op: 'add', parent: path, key: k, ...(v === '' ? {} : { value: coerce(v) }) }])
                }}><Plus size={12} /></button>
                <button title="Remove block" onClick={() => { if (window.confirm(`Remove block '${n.k}' and its children?`)) onEdit([{ op: 'remove', path }]) }}><Trash2 size={12} /></button>
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
        <button className="btn sm" onClick={() => {
          const k = window.prompt('New top-level key:')
          if (!k) return
          const v = window.prompt('Value (leave empty for a block):') ?? ''
          onEdit([{ op: 'add', parent: '', key: k, ...(v === '' ? {} : { value: coerce(v) }) }])
        }}><Plus size={12} /> Add key</button>
      </div>
      <ul className={styles.tree}>{renderNodes(entity.tree.root, '', 0)}</ul>
      {picker && (
        <AssetPicker kind={picker.kind} value={picker.value} fieldKey={picker.key}
                     onPick={(v) => onEdit([{ op: 'set', path: picker.path, value: v }])} onClose={() => setPicker(null)} />
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

function ValueCell({ raw, onCommit, busy }: { raw: string; onCommit: (v: unknown) => void; busy?: boolean }) {
  const kind = tokenKind(raw)
  const initial = tokenToValue(raw)
  const [draft, setDraft] = useState(initial === null ? '' : String(initial))
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
