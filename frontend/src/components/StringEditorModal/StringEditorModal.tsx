import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, FileDown } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { ApiError } from '@/api/client'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { toast } from '@/store/useToastStore'
import { Modal } from '@/components/Modal/Modal'
import styles from './StringEditorModal.module.css'

/** Global editor for one localisation string; opened from any string-ID field. Mounted once in App. */
export function StringEditorModal() {
  const { stringId, isNew, close } = useStringEditorStore()
  if (!stringId) return null
  return <Editor key={stringId} stringId={stringId} isNew={isNew} onClose={close} />
}

function Editor({ stringId, isNew, onClose }: { stringId: string; isNew: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['string', stringId],
    queryFn: () => catalogApi.getString(stringId),
    retry: false,
  })
  const missing = error instanceof ApiError && error.status === 404
  const [draft, setDraft] = useState('')
  useEffect(() => { if (data) setDraft(data.value) }, [data])

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['string', stringId] })
    qc.invalidateQueries({ queryKey: ['strings'] })
    qc.invalidateQueries({ queryKey: ['entities'] })    // display names come from strings
    qc.invalidateQueries({ queryKey: ['entity'] })
  }
  const save = useMutation({
    mutationFn: async (andWrite: boolean) => {
      await catalogApi.putString(stringId, draft)
      if (andWrite) await catalogApi.writeStrings()
      return andWrite
    },
    onSuccess: (wrote) => { invalidate(); toast.success(wrote ? 'String saved and English.str written' : 'String saved'); onClose() },
    onError: (e: Error) => toast.error(`Could not save string: ${e.message}`),
  })

  const dirty = draft !== (data?.value ?? '')
  const footer = (
    <>
      {data?.isModified && !isNew && <span className={styles.note}>modified, not yet written</span>}
      <span className={styles.spacer} />
      <button type="button" className="btn sm" onClick={onClose}>Cancel</button>
      <button type="button" className="btn sm" disabled={save.isPending || (!dirty && !missing)} onClick={() => save.mutate(false)} title="Save to the project; write the .str file later">
        <Save size={13} /> Save
      </button>
      <button type="button" className="btn sm primary" disabled={save.isPending} onClick={() => save.mutate(true)} title="Save and rewrite String/English.str now">
        <FileDown size={13} /> Save &amp; write .str
      </button>
    </>
  )

  return (
    <Modal title={isNew ? 'New string' : 'Edit string'} onClose={onClose} footer={footer} width={560}>
      <div className={styles.field}>
        <label className={styles.label}>String ID</label>
        <code className={styles.id}>{stringId}</code>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="string-value">Value</label>
        {isLoading ? <p className="muted">Loading…</p> : (
          <textarea id="string-value" className={styles.value} rows={5} value={draft} autoFocus spellCheck
                    onChange={(e) => setDraft(e.target.value)} placeholder={missing ? 'This ID has no string yet; saving creates it in English.str' : ''} />
        )}
      </div>
      {isNew && <p className={styles.hint}>A placeholder was created automatically because the entity now points at this ID. Replace it with the text players should see.</p>}
      {data && data.isModified && data.originalValue !== draft && data.originalValue && (
        <div className={styles.field}>
          <label className={styles.label}>On disk</label>
          <p className={styles.original}>{data.originalValue}</p>
        </div>
      )}
      <p className={styles.meta}>{data?.sourceFile ?? 'String/English.str'}{data?.line ? ` · line ${data.line}` : ''}{data?.duplicateCount && data.duplicateCount > 1 ? ` · defined ${data.duplicateCount}×` : ''}</p>
    </Modal>
  )
}
