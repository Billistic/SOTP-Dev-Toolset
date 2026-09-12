import { useEffect, useState } from 'react'
import { ExternalLink, FolderOpen, MessageSquareText, Scale } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { catalogApi } from '@/api/catalog'
import { ApiError } from '@/api/client'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { useUiStore } from '@/store/useUiStore'
import { tokenKind, tokenToValue } from '@/utils/tree'
import { isEnter, isEscape } from '@/utils/keys'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import type { FieldSpec } from '@/types/api'
import styles from './FieldRow.module.css'

interface Props {
  spec: Pick<FieldSpec, 'label' | 'kind' | 'ref' | 'enum' | 'unit' | 'help' | 'balance'>
  path: string
  raw: string | undefined          // undefined when the field is absent from this entity
  entityType: string
  onCommit: (value: unknown) => void
  busy?: boolean
}

/** One labelled editable field. Commits on blur / Enter; Escape restores. */
export function FieldRow({ spec, path, raw, entityType, onCommit, busy }: Props) {
  const initial = tokenToValue(raw)
  const [draft, setDraft] = useState<string>(initial === null ? '' : String(initial))
  useEffect(() => { setDraft(initial === null ? '' : String(initial)) }, [raw]) // eslint-disable-line react-hooks/exhaustive-deps
  const openEntity = useUiStore((s) => s.openEntity)
  const openString = useStringEditorStore((s) => s.open)
  const [picking, setPicking] = useState(false)

  // string-ID fields show the localised text beside the ID and open the string editor
  const stringId = spec.ref === 'string' && raw !== undefined && draft ? draft : null
  const { data: str, error: strError } = useQuery({
    queryKey: ['string', stringId],
    queryFn: () => catalogApi.getString(stringId!),
    enabled: !!stringId,
    retry: false,
  })
  const strMissing = strError instanceof ApiError && strError.status === 404

  const enumKey = spec.kind === 'enum' ? path.split('.').pop()!.split('[')[0] : null
  const { data: options } = useQuery({
    queryKey: ['field-values', enumKey, entityType],
    queryFn: () => catalogApi.fieldValues(enumKey!, entityType),
    enabled: !!enumKey,
    staleTime: 5 * 60_000,
  })

  const missing = raw === undefined
  const kind = raw === undefined ? spec.kind : tokenKind(raw)
  const dirty = draft !== (initial === null ? '' : String(initial))

  const commit = () => {
    if (!dirty || missing) return
    if (kind === 'int' || kind === 'float') {
      const n = Number(draft)
      if (Number.isNaN(n)) { setDraft(String(initial)); return }
      onCommit(n)
    } else if (kind === 'array') {
      const nums = draft.replace(/[[\],]/g, ' ').trim().split(/\s+/).map(Number)
      if (nums.some(Number.isNaN)) { setDraft(String(initial)); return }
      onCommit(nums)
    } else onCommit(draft)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (isEnter(e)) { e.preventDefault(); commit() }
    if (isEscape(e)) setDraft(initial === null ? '' : String(initial))
  }

  return (
    <div className={styles.row} data-missing={missing || undefined} data-balance={spec.balance || undefined}>
      <label className={styles.label} title={`${path}${spec.help ? `\n${spec.help}` : ''}`}>
        {spec.label}
        {spec.balance && <Scale size={11} className={styles.balanceTag} aria-label="Affects balance metrics" />}
      </label>
      <div className={styles.control}>
        {missing ? <span className={styles.absent}>not set</span>
          : kind === 'bool' ? (
            <input type="checkbox" checked={draft === 'true'} disabled={busy}
                   onChange={(e) => { setDraft(String(e.target.checked)); onCommit(e.target.checked) }} />
          ) : spec.kind === 'enum' && options ? (
            <select value={draft} disabled={busy} onChange={(e) => { setDraft(e.target.value); onCommit(e.target.value) }}>
              {!options.includes(draft) && <option value={draft}>{draft}</option>}
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className={kind === 'int' || kind === 'float' ? styles.num : styles.text} type="text" value={draft} disabled={busy}
                   data-dirty={dirty || undefined} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey}
                   spellCheck={false} />
          )}
        {spec.unit && !missing && <span className={styles.unit}>{spec.unit}</span>}
        {spec.ref && !missing && (
          <button className={styles.link} title={`Choose ${spec.ref} from the index`} onClick={() => setPicking(true)}><FolderOpen size={13} /></button>
        )}
        {picking && spec.ref && (
          <AssetPicker kind={spec.ref} value={draft} fieldKey={path.split('.').pop()!.split('[')[0]}
                       onPick={(v) => { setDraft(v); onCommit(v) }} onClose={() => setPicking(false)} />
        )}
        {spec.ref === 'entity' && draft && (
          <button className={styles.link} title={`Open ${draft}`} onClick={() => openEntity(draft)}><ExternalLink size={13} /></button>
        )}
        {stringId && (
          <>
            <button className={styles.link} title={strMissing ? 'No string with this ID yet - click to create it' : 'Edit the localised text'}
                    onClick={() => openString(stringId, strMissing)}><MessageSquareText size={13} /></button>
            {str && <span className={styles.preview} title={str.value}>{str.value}</span>}
            {strMissing && <span className={styles.previewMissing}>no string</span>}
          </>
        )}
      </div>
    </div>
  )
}
