import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { GitCompareArrows, Plus, Save, Search, Trash2 } from 'lucide-react'
import { MAX_STRING_LEN, PRIMARY_STR, catalogApi, strFileLabel } from '@/api/catalog'
import { useDebounce } from '@/hooks/useDebounce'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { toast } from '@/store/useToastStore'
import { StringChangesPanel } from '@/components/StringChangesPanel/StringChangesPanel'
import type { GameString } from '@/types/api'
import { PromptDialog } from '@/components/PromptDialog/PromptDialog'
import styles from './StringsView.module.css'

/** Localisation table, one .str file at a time (English.str, French.str ...): search, inline edit, add / remove IDs,
 *  review the delta against disk, write the file. */
export function StringsView() {
  const [search, setSearch] = useState('')
  const [modifiedOnly, setModifiedOnly] = useState(false)
  const [tooLongOnly, setTooLongOnly] = useState(false)
  const [file, setFile] = useState(PRIMARY_STR)
  const [tab, setTab] = useState<'all' | 'changes'>('all')
  const debounced = useDebounce(search)
  const qc = useQueryClient()
  const openString = useStringEditorStore((s) => s.open)
  const { data: files } = useQuery({ queryKey: ['strings', 'files'], queryFn: catalogApi.stringFiles, retry: false })
  const current = files?.files.find((f) => f.file === file)
  const fileName = strFileLabel(file)
  const { data, isLoading } = useQuery({
    queryKey: ['strings', file, debounced, modifiedOnly, tooLongOnly],
    queryFn: () => catalogApi.strings({ file, search: debounced || undefined, modified: modifiedOnly || undefined, too_long: tooLongOnly || undefined, limit: 1000 }),
    retry: false,
    enabled: tab === 'all',
  })
  const { data: changes } = useQuery({ queryKey: ['strings', 'changes'], queryFn: catalogApi.stringChanges, retry: false })
  const changeCount = changes ? changes.new.length + changes.modified.length + changes.deleted.length : 0

  const invalidate = () => { qc.invalidateQueries({ queryKey: ['strings'] }); qc.invalidateQueries({ queryKey: ['string'] }); qc.invalidateQueries({ queryKey: ['diagnostics'] }) }
  const save = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => catalogApi.putString(id, value, file),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => catalogApi.deleteString(id, file),
    onSuccess: (_r, id) => { invalidate(); toast.info(`Removed ${id}; revert it from the Changes tab if that was a mistake`) },
    onError: (e: Error) => toast.error(e.message),
  })
  const write = useMutation({
    mutationFn: () => catalogApi.writeStrings(file),
    onSuccess: (r) => { toast.success(`Written ${r.written}`); invalidate() },
    onError: (e: Error) => toast.error(e.message),
  })

  const [adding, setAdding] = useState(false)

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <nav className={styles.tabs} role="tablist">
          <button role="tab" aria-selected={tab === 'all'} className={styles.tab} data-active={tab === 'all' || undefined} onClick={() => setTab('all')}>All strings</button>
          <button role="tab" aria-selected={tab === 'changes'} className={styles.tab} data-active={tab === 'changes' || undefined} onClick={() => setTab('changes')}>
            <GitCompareArrows size={13} /> Changes{changeCount > 0 && <span className={styles.badge}>{changeCount}</span>}
          </button>
        </nav>
        {(files?.files.length ?? 0) > 1 && (
          <select value={file} onChange={(e) => setFile(e.target.value)} title="Localisation file shown and written">
            {files!.files.map((f) => <option key={f.file} value={f.file}>{strFileLabel(f.file)} ({f.count}{f.changes ? `, ${f.changes} changed` : ''})</option>)}
          </select>
        )}
        {tab === 'all' && (
          <>
            <div className={styles.search}><Search size={14} /><input type="search" data-bare placeholder="Search IDs and text…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <label className={styles.check}><input type="checkbox" checked={modifiedOnly} onChange={(e) => setModifiedOnly(e.target.checked)} /> changed only</label>
            {(current?.tooLong ?? 0) > 0 && (
              <label className={styles.check} title={`Values longer than the ${MAX_STRING_LEN} characters Sins reads`}>
                <input type="checkbox" checked={tooLongOnly} onChange={(e) => setTooLongOnly(e.target.checked)} /> over {MAX_STRING_LEN} chars <span className={styles.over}>{current!.tooLong}</span>
              </label>
            )}
            <span className="muted">{data ? `${data.rows.length} of ${data.total}` : ''}</span>
          </>
        )}
        <span className={styles.spacer} />
        <button className="btn sm" onClick={() => setAdding(true)}><Plus size={12} /> Add string</button>
        <button className="btn sm primary" onClick={() => write.mutate()} disabled={write.isPending || !current?.changes}
                title={current?.changes ? `Write ${current.changes} change(s) to ${file}` : `Nothing to write in ${fileName}`}>
          <Save size={12} /> Write {fileName}
        </button>
      </div>
      <div className={styles.body}>
        {tab === 'changes' ? <StringChangesPanel /> : isLoading ? <p className={styles.hint}>Loading…</p> : (
          <table className={styles.table}>
            <thead><tr><th>ID</th><th>Value</th><th></th></tr></thead>
            <tbody>
              {data?.rows.map((s) => (
                <Row key={s.id} s={s} onSave={(v) => save.mutate({ id: s.stringId, value: v })} onDelete={() => remove.mutate(s.stringId)} onOpen={() => openString(s.stringId, false, file)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
      {adding && (
        <PromptDialog title="New string" submitLabel="Create"
                      fields={[{ name: 'id', label: 'String ID', placeholder: 'e.g. Frigate_UNSC_Able_Name', mono: true, required: true,
                                 validate: (v) => (/^[A-Za-z0-9_\-.:]+$/.test(v.trim()) ? null : 'letters, digits, _ - . : only'),
                                 hint: `The text is entered next; the entry is written to ${fileName} on the next "Write ${fileName}".` }]}
                      onSubmit={(v) => { setAdding(false); openString(v.id, true, file) }} onClose={() => setAdding(false)} />
      )}
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
        {draft.length > MAX_STRING_LEN && (
          <span className={styles.over} title={`Sins reads at most ${MAX_STRING_LEN} characters; the game may cut the rest off`}>{draft.length} / {MAX_STRING_LEN}</span>
        )}
      </td>
      <td className={styles.status}>
        {s.isModified && !s.isNew && <span title={`On disk: ${s.originalValue}`}>edited</span>}
        {!s.isDeleted && <button className={styles.rowBtn} onClick={onDelete} title="Remove this string (revertable until written)"><Trash2 size={12} /></button>}
      </td>
    </tr>
  )
}
