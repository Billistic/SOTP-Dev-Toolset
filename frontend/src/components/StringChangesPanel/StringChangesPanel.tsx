import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { toast } from '@/store/useToastStore'
import { wordDiff } from '@/utils/diff'
import type { GameString } from '@/types/api'
import styles from './StringChangesPanel.module.css'

type Status = 'new' | 'modified' | 'deleted'

/** Everything the editor holds that differs from the .str files on disk, with per-row and bulk revert. */
export function StringChangesPanel() {
  const qc = useQueryClient()
  const openString = useStringEditorStore((s) => s.open)
  const { data, isLoading } = useQuery({ queryKey: ['strings', 'changes'], queryFn: catalogApi.stringChanges, retry: false })

  const done = (msg?: string) => {
    qc.invalidateQueries({ queryKey: ['strings'] })
    qc.invalidateQueries({ queryKey: ['string'] })
    qc.invalidateQueries({ queryKey: ['diagnostics'] })
    qc.invalidateQueries({ queryKey: ['entities'] })
    if (msg) toast.success(msg)
  }
  const revert = useMutation({
    mutationFn: (ids?: string[]) => catalogApi.revertStrings(ids),
    onSuccess: (r) => done(`Reverted ${r.reverted} string(s)`),
    onError: (e: Error) => toast.error(e.message),
  })

  if (isLoading || !data) return <p className={styles.hint}>Loading…</p>
  const rows: { s: GameString; status: Status }[] = [
    ...data.new.map((s) => ({ s, status: 'new' as Status })),
    ...data.modified.map((s) => ({ s, status: 'modified' as Status })),
    ...data.deleted.map((s) => ({ s, status: 'deleted' as Status })),
  ]
  const total = rows.length
  const busy = revert.isPending

  return (
    <div className={styles.root}>
      <div className={styles.summary}>
        <span className={styles.pill} data-status="new">{data.new.length} new</span>
        <span className={styles.pill} data-status="modified">{data.modified.length} edited</span>
        <span className={styles.pill} data-status="deleted">{data.deleted.length} removed</span>
        <span className="muted">{total === 0 ? 'The editor matches the files on disk.' : 'Not yet written to disk.'}</span>
        <span className={styles.spacer} />
        <button className="btn sm" disabled={!total || busy} onClick={() => revert.mutate(undefined)} title="Discard every string change"><Undo2 size={12} /> Revert all</button>
      </div>
      {total > 0 && (
        <table className={styles.table}>
          <thead><tr><th></th><th>ID</th><th>On disk</th><th>In the tool</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ s, status }) => (
              <tr key={s.id} data-status={status}>
                <td><span className={styles.pill} data-status={status}>{status === 'modified' ? 'edited' : status === 'deleted' ? 'removed' : 'new'}</span></td>
                <td className={styles.id}><button className={styles.idBtn} onClick={() => openString(s.stringId)} title="Open in the string editor">{s.stringId}</button>
                  <div className={styles.meta}>{s.sourceFile}{s.line ? `:${s.line}` : ''}</div></td>
                <td className={styles.text}>{status === 'new' ? <span className={styles.none}>(absent)</span> : <Diff before={s.originalValue} after={status === 'deleted' ? '' : s.value} side="before" />}</td>
                <td className={styles.text}>{status === 'deleted' ? <span className={styles.none}>(removed)</span> : <Diff before={status === 'new' ? '' : s.originalValue} after={s.value} side="after" />}</td>
                <td><button className={styles.revert} disabled={busy} onClick={() => revert.mutate([s.stringId])} title="Restore what is on disk"><Undo2 size={12} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** One side of a word diff: the "before" side shows deletions, the "after" side shows additions. */
function Diff({ before, after, side }: { before: string; after: string; side: 'before' | 'after' }) {
  const parts = wordDiff(before, after).filter((p) => p.op === 'same' || (side === 'before' ? p.op === 'del' : p.op === 'add'))
  return <>{parts.map((p, i) => p.op === 'same' ? <span key={i}>{p.text}</span> : <mark key={i} className={styles.mark} data-op={p.op}>{p.text}</mark>)}</>
}
