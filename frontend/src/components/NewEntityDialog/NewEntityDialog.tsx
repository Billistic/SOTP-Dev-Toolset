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

/** Create an entity by copying an existing one of the same type (the project's or a base-game file), or from scratch following its definition (grammar). */
export function NewEntityDialog({ initialType, initialTemplate, onClose, onCreated }: Props) {
  const qc = useQueryClient()
  const openEntity = useUiStore((s) => s.openEntity)
  const openString = useStringEditorStore((s) => s.open)
  const [source, setSource] = useState<'copy' | 'definition'>('copy')
  const [type, setType] = useState(initialType ?? '')
  const [template, setTemplate] = useState(initialTemplate ?? '')
  const [templateSource, setTemplateSource] = useState<'mod' | 'vanilla'>('mod')
  const [name, setName] = useState(initialTemplate ? copyName(initialTemplate) : '')
  const [ownStrings, setOwnStrings] = useState(true)

  const { data: types } = useQuery({ queryKey: ['entities', 'types'], queryFn: entitiesApi.types })
  const { data: defTypes } = useQuery({ queryKey: ['entities', 'definition-types'], queryFn: entitiesApi.definitionTypes, staleTime: Infinity })
  const { data: vanilla } = useQuery({ queryKey: ['entities', 'vanilla-templates'], queryFn: entitiesApi.vanillaTemplates })
  const vanillaByType = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const t of vanilla?.templates ?? []) m.set(t.entityType, [...(m.get(t.entityType) ?? []), t.name])
    return m
  }, [vanilla])
  const typeOptions = useMemo(() => {
    const counts = new Map((types ?? []).map((t) => [t.entityType, t.count]))
    if (source === 'definition') return (defTypes ?? []).map((t) => ({ value: t, count: counts.get(t) ?? 0, base: 0 }))
    // copy: the project's types (in category order), then any only the base game has
    const baseOnly = [...vanillaByType.keys()].filter((t) => !counts.has(t)).sort((a, b) => a.localeCompare(b))
    return [...counts.keys(), ...baseOnly].map((t) => ({ value: t, count: counts.get(t) ?? 0, base: vanillaByType.get(t)?.length ?? 0 }))
  }, [source, types, defTypes, vanillaByType])
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
  const baseNames = type ? vanillaByType.get(type) ?? [] : []

  const create = useMutation({
    mutationFn: () => entitiesApi.create(source === 'copy' ? { name: name.trim(), template, templateSource, ownStrings }
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
          {typeOptions.map((t) => (
            <option key={t.value} value={t.value}>{t.value} ({t.count}{t.base ? ` · ${t.base} base game` : ''})</option>
          ))}
        </select>

        {source === 'copy' ? (
          <>
            <label className={styles.label} htmlFor="ne-template">Copy from</label>
            <div>
              <select id="ne-template" value={template ? `${templateSource}:${template}` : ''} disabled={!type}
                      onChange={(e) => {
                        const [src, ...rest] = e.target.value.split(':')
                        setTemplateSource(src === 'vanilla' ? 'vanilla' : 'mod')
                        setTemplate(rest.join(':'))
                      }}>
                <option value="">{type ? 'Choose a template…' : 'Pick a type first'}</option>
                {grouped.map(([fac, names]) => (
                  <optgroup key={fac} label={fac}>{names.map((n) => <option key={n} value={`mod:${n}`}>{n}</option>)}</optgroup>
                ))}
                {baseNames.length > 0 && (
                  <optgroup label="Base game">{baseNames.map((n) => <option key={n} value={`vanilla:${n}`}>{n}</option>)}</optgroup>
                )}
              </select>
              {vanilla && !vanilla.available && (
                <p className={styles.hint}>Set a Base game root in Project settings to copy base-game entities too.</p>
              )}
              {!!vanilla?.binary && (
                <p className={styles.hint}>{vanilla.binary} base-game files are binary (BIN) and not listed; convert them with ConvertData to copy them.</p>
              )}
            </div>
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
