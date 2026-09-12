import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitCompareArrows, Plus, Save, Search, Trash2 } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { useDebounce } from '@/hooks/useDebounce'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { toast } from '@/store/useToastStore'
import { StringChangesPanel } from '@/components/StringChangesPanel/StringChangesPanel'
import type { GameString } from '@/types/api'
import styles from './StringsView.module.css'

/** Localisation table: search, inline edit, add / remove IDs, review the delta against disk, write English.str. */
export function StringsView() {
  const [search, setSearch] = useState('')
  const [modifiedOnly, setModifiedOnly] = useState(false)
  const [tab, setTab] = useState<'all' | 'changes'>('all')
  const debounced = useDebounce(search)
  const qc = useQueryClient()
  const openString = useStringEditorStore((s) => s.open)
  const { data, isLoading } = useQuery({
    queryKey: ['strings', debounced, modifiedOnly],
    queryFn: () => catalogApi.strings({ search: debounced || undefined, modified: modifiedOnly || undefined, limit: 1000 }),
    retry: false,
    enabled: tab === 'all',
  })
  const { data: changes } = useQuery({ queryKey: ['strings', 'changes'], queryFn: catalogApi.stringChanges, retry: false })
  const changeCount = changes ? changes.new.length + changes.modified.length + changes.deleted.length : 0

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['strings'] }); qc.invalidateQueries({ queryKey: ['string'] }); qc.invalidateQueries({ queryKey: ['diagnostics'] }) }
  const save = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => catalogApi.putString(id, value),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => catalogApi.deleteString(id),
    onSuccess: (_r, id) => { invalidate(); toast.info(`Removed ${id}; revert it from the Changes tab if that was a mistake`) },
    onError: (e: Error) => toast.error(e.message),
  })
  const write = useMutation({
    mutationFn: () => catalogApi.writeStrings(),
    onSuccess: (r) => { toast.success(`Written ${r.written}`); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const add = () => {
    const id = window.prompt('New string ID:')?.trim()
    if (id) openString(id, true)
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <nav className={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === 'all'} className={styles.tab} data-active={tab === 'all' || undefined} onClick={() => setTab('all')}>All strings</button>
          <button role="tab" aria-selected={tab === 'changes'} className={styles.tab} data-active={tab === 'changes' || undefined} onClick={() => setTab('changes')}>
            <GitCompareArrows size={13} /> Changes{changeCount > 0 && <span className={styles.badge}>{changeCount}</span>}
          </button>
        </nav>
        {tab === 'all' && (
          <>
            <div className={styles.search}><Search size={14} /><input type="search" data-bare placeholder="Search IDs and text…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <label className={styles.check}><input type="checkbox" checked={modifiedOnly} onChange={(e) => setModifiedOnly(e.target.checked)} /> changed only</label>
            <span className="muted">{data ? `${data.rows.length} of ${data.total}` : ''}</span>
          </>
        )}
        <span className={styles.spacer} />
        <button className="btn sm" onClick={add}><Plus size={12} /> Add string</button>
        <button className="btn sm primary" onClick={() => write.mutate()} disabled={write.isPending || changeCount === 0} title={changeCount ? `Write ${changeCount} change(s) to String/English.str` : 'Nothing to write'}>
          <Save size={12} /> Write English.str
        </button>
      </div>
      <div className={styles.body}>
        {tab === 'changes' ? <StringChangesPanel /> : isLoading ? <p className={styles.hint}>Loading…</p> : (
          <table className={styles.table}>
            <thead><tr><th>ID</th><th>Value</th><th></th></tr></thead>
            <tbody>
              {data?.rows.map((s) => (
                <Row key={s.id} s={s} onSave={(v) => save.mutate({ id: s.stringId, value: v })} onDelete={() => remove.mutate(s.stringId)} onOpen={() => openString(s.stringId)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Row({ s, onSave, onDelete, onOpen }: { s: GameString; onSave: (v: string) => void; onDelete: () => void; onOpen: () => void }) {
  const [draft, setDraft] = useState(s.value)
  const dirty = draft !== s.value
  return (
    <tr data-modified={s.isModified || s.isNew || s.isDeleted || undefined} data-deleted={s.isDeleted || undefined}>
      <td className={styles.id} title={`${s.sourceFile}:${s.line ?? ''}${s.duplicateCount > 1 ? ` (defined ${s.duplicateCount}×)` : ''}`}>
        <button className={styles.idBtn} onClick={onOpen} title="Open in the string editor">{s.stringId}</button>
        {s.isNew && <span className={styles.new}>new</span>}{s.isDeleted && <span className={styles.dup}>removed</span>}{s.duplicateCount > 1 && <span className={styles.dup}>dup</span>}
      </td>
      <td>
        <textarea className={styles.value} value={draft} rows={Math.min(6, Math.max(1, Math.ceil(draft.length / 110)))} spellCheck disabled={s.isDeleted}
                  onChange={(e) => setDraft(e.target.value)} onBlur={() => dirty && onSave(draft)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setDraft(s.value) }} data-dirty={dirty || undefined} />
      </td>
      <td className={styles.status}>
        {s.isModified && !s.isNew && <span title={`On disk: ${s.originalValue}`}>edited</span>}
        {!s.isDeleted && <button className={styles.rowBtn} onClick={onDelete} title="Remove this string (revertable until written)"><Trash2 size={12} /></button>}
      </td>
    </tr>
  )
}
