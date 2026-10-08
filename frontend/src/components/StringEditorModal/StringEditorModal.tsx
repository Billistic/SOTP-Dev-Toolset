import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, FileDown } from 'lucide-react'
import { MAX_STRING_LEN, PRIMARY_STR, catalogApi, strFileLabel } from '@/api/catalog'
import { ApiError } from '@/api/client'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { toast } from '@/store/useToastStore'
import { Modal } from '@/components/Modal/Modal'
import styles from './StringEditorModal.module.css'

/** Global editor for one localisation string; opened from any string-ID field. Mounted once in App. */
export function StringEditorModal() {
  const { stringId, isNew, file, close } = useStringEditorStore()
  if (!stringId) return null
  return <Editor key={`${file ?? ''}:${stringId}`} stringId={stringId} isNew={isNew} file={file ?? PRIMARY_STR} onClose={close} />
}

function Editor({ stringId, isNew, file, onClose }: { stringId: string; isNew: boolean; file: string; onClose: () => void }) {
  const qc = useQueryClient()
  const fileName = strFileLabel(file)
  const { data, isLoading, error } = useQuery({
    queryKey: ['string', stringId, file],
    queryFn: () => catalogApi.getString(stringId, file),
    retry: false,
  })
  const missing = error instanceof ApiError && error.status === 404
  const translation = file !== PRIMARY_STR
  const { data: english } = useQuery({                      // QA #14: the English text to translate from
    queryKey: ['string', stringId, PRIMARY_STR],
    queryFn: () => catalogApi.getString(stringId, PRIMARY_STR),
    enabled: translation,
    retry: false,
  })
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
      await catalogApi.putString(stringId, draft, file)
      if (andWrite) await catalogApi.writeStrings(file)
      return andWrite
    },
    onSuccess: (wrote) => { invalidate(); toast.success(wrote ? `String saved and ${fileName} written` : 'String saved'); onClose() },
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
      <button type="button" className="btn sm primary" disabled={save.isPending} onClick={() => save.mutate(true)} title={`Save and rewrite ${file} now`}>
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
      {translation && (
        <div className={styles.field}>
          <label className={styles.label}>English (reference)
            {english && <button type="button" className={styles.copy} onClick={() => setDraft(english.value)} title="Start from the English text">use</button>}</label>
          <p className={styles.original}>{english ? english.value : 'not in English.str'}</p>
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor="string-value">{translation ? fileName : 'Value'}</label>
        {isLoading ? <p className="muted">Loading…</p> : (
          <textarea id="string-value" className={styles.value} rows={5} value={draft} autoFocus spellCheck
                    onChange={(e) => setDraft(e.target.value)} placeholder={missing ? `This ID has no string yet; saving creates it in ${fileName}` : ''} />
        )}
        <span className={styles.counter} data-over={draft.length > MAX_STRING_LEN || undefined}
              title={`Sins reads at most ${MAX_STRING_LEN} characters per string`}>
          {draft.length} / {MAX_STRING_LEN}{draft.length > MAX_STRING_LEN ? ` \u2013 ${draft.length - MAX_STRING_LEN} over; the game may cut it off` : ''}
        </span>
      </div>
      {isNew && <p className={styles.hint}>A placeholder was created automatically because the entity now points at this ID. Replace it with the text players should see.</p>}
      {data && data.isModified && data.originalValue !== draft && data.originalValue && (
        <div className={styles.field}>
          <label className={styles.label}>On disk</label>
          <p className={styles.original}>{data.originalValue}</p>
        </div>
      )}
      <p className={styles.meta}>{data?.sourceFile ?? file}{data?.line ? ` · line ${data.line}` : ''}{data?.duplicateCount && data.duplicateCount > 1 ? ` · defined ${data.duplicateCount}×` : ''}</p>
    </Modal>
  )
}
