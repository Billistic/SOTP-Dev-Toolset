import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FilePlus } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useUiStore } from '@/store/useUiStore'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { toast } from '@/store/useToastStore'
import { Modal } from '@/components/Modal/Modal'
import styles from './NewEntityDialog.module.css'

interface Props {
  initialType?: string
  initialTemplate?: string
  onClose: () => void
  onCreated?: (name: string) => void   // e.g. the graph wiring the new entity up; when given the entity tab is not opened
}

const NAME_RE = /^[A-Za-z0-9_\-.]+$/
const FACTION_TAGS = new Set(['regr', 'regret', 'thel', 'cole', 'hood', 'stan', 'stanforth', 'all'])

/** "Frigate_UNSC_Able_Cole" -> "Frigate_UNSC_Able" (mirrors the backend's strip_faction_suffix). */
function stem(name: string) {
  const parts = name.split('_').filter(Boolean)
  if (parts.length > 1 && FACTION_TAGS.has(parts[parts.length - 1].toLowerCase())) parts.pop()
  return parts.join('_') || name
}

/** "Frigate_UNSC_Able_Cole" -> "Frigate_UNSC_Able_Copy_Cole": keeps the faction tag last so grouping still works. */
function copyName(template: string) {
  const s = stem(template)
  return s === template ? `${template}_Copy` : `${s}_Copy${template.slice(s.length)}`
}

/** Create an entity by copying an existing one of the same type, or from scratch following its definition (grammar). */
export function NewEntityDialog({ initialType, initialTemplate, onClose, onCreated }: Props) {
  const qc = useQueryClient()
  const openEntity = useUiStore((s) => s.openEntity)
  const openString = useStringEditorStore((s) => s.open)
  const [source, setSource] = useState<'copy' | 'definition'>('copy')
  const [type, setType] = useState(initialType ?? '')
  const [template, setTemplate] = useState(initialTemplate ?? '')
  const [name, setName] = useState(initialTemplate ? copyName(initialTemplate) : '')
  const [ownStrings, setOwnStrings] = useState(true)

  const { data: types } = useQuery({ queryKey: ['entities', 'types'], queryFn: entitiesApi.types })
  const { data: defTypes } = useQuery({ queryKey: ['entities', 'definition-types'], queryFn: entitiesApi.definitionTypes, staleTime: Infinity })
  const typeOptions = useMemo(() => {
    const counts = new Map((types ?? []).map((t) => [t.entityType, t.count]))
    return source === 'copy' ? (types ?? []).map((t) => ({ value: t.entityType, count: t.count }))
                             : (defTypes ?? []).map((t) => ({ value: t, count: counts.get(t) ?? 0 }))
  }, [source, types, defTypes])
  const { data: candidates } = useQuery({
    queryKey: ['entities', 'list', 'by-type', type],
    queryFn: () => entitiesApi.list({ entity_type: type }),
    enabled: !!type,
  })
  const grouped = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const e of candidates ?? []) m.set(e.faction ?? 'Shared', [...(m.get(e.faction ?? 'Shared') ?? []), e.name])
    return [...m.entries()].sort()
  }, [candidates])

  const create = useMutation({
    mutationFn: () => entitiesApi.create(source === 'copy' ? { name: name.trim(), template, ownStrings }
                                                           : { name: name.trim(), entityType: type, ownStrings }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['entities'] })
      qc.invalidateQueries({ queryKey: ['diagnostics'] })
      qc.invalidateQueries({ queryKey: ['strings'] })
      toast.success(`Created ${d.name} (not on disk until you Write it)`)
      if (onCreated) onCreated(d.name)
      else openEntity(d.name)
      onClose()
      const first = d.createdStrings?.[0]
      if (first) openString(first.stringId, true)
    },
    onError: (e: Error) => toast.error(`Could not create entity: ${e.message}`),
  })

  const nameOk = NAME_RE.test(name.trim())
  const exists = (candidates ?? []).some((e) => e.name.toLowerCase() === name.trim().toLowerCase())
  const canCreate = nameOk && !exists && (source === 'copy' ? !!template : !!type) && !create.isPending
  const footer = (
    <>
      <span className={styles.spacer} />
      <button type="button" className="btn sm" onClick={onClose}>Cancel</button>
      <button type="button" className="btn sm primary" disabled={!canCreate} onClick={() => create.mutate()}>
        {source === 'copy' ? <Copy size={13} /> : <FilePlus size={13} />} Create
      </button>
    </>
  )

  return (
    <Modal title="New entity" onClose={onClose} footer={footer} width={540}>
      <div className={styles.grid}>
        <span className={styles.label}>Start from</span>
        <div className={styles.seg} role="group" aria-label="Start from">
          {([['copy', 'an existing entity'], ['definition', 'the definition']] as const).map(([v, l]) => (
            <button key={v} type="button" data-active={source === v || undefined} onClick={() => { setSource(v); setTemplate('') }}>{l}</button>
          ))}
        </div>

        <label className={styles.label} htmlFor="ne-type">Type</label>
        <select id="ne-type" value={type} onChange={(e) => { setType(e.target.value); setTemplate('') }}>
          <option value="">Choose a type…</option>
          {type && !typeOptions.some((t) => t.value === type) && <option value={type}>{type}</option>}
          {typeOptions.map((t) => <option key={t.value} value={t.value}>{t.value} ({t.count})</option>)}
        </select>

        {source === 'copy' ? (
          <>
            <label className={styles.label} htmlFor="ne-template">Copy from</label>
            <select id="ne-template" value={template} disabled={!type} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">{type ? 'Choose a template…' : 'Pick a type first'}</option>
              {grouped.map(([fac, names]) => (
                <optgroup key={fac} label={fac}>{names.map((n) => <option key={n} value={n}>{n}</option>)}</optgroup>
              ))}
            </select>
          </>
        ) : (
          <>
            <span />
            <p className={styles.hint}>
              Every field of a {type || 'type'} in definition order with default values. Choosing an option in the form brings in the fields
              that option needs; counts add their blocks.
            </p>
          </>
        )}

        <label className={styles.label} htmlFor="ne-name">Name</label>
        <div>
          <input id="ne-name" type="text" className={styles.name} value={name} autoFocus spellCheck={false}
                 onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canCreate) create.mutate() }}
                 placeholder="Frigate_UNSC_Newship_Cole" />
          {name && !nameOk && <p className={styles.err}>Letters, digits, _ - . only</p>}
          {exists && <p className={styles.err}>An entity with this name already exists</p>}
          {nameOk && !exists && <p className={styles.hint}>GameInfo/{name.trim()}.entity</p>}
        </div>

        <span />
        <label className={styles.check}>
          <input type="checkbox" checked={ownStrings} onChange={(e) => setOwnStrings(e.target.checked)} />
          Give it its own name / description strings
          {ownStrings && nameOk && <span className={styles.ids}>{stem(name.trim())}_Name · {stem(name.trim())}_Desc</span>}
        </label>
      </div>
      <p className={styles.hint}>The new entity lives in the project until you press <strong>Write</strong>; write the manifest from Project settings so the game loads it.</p>
    </Modal>
  )
}
