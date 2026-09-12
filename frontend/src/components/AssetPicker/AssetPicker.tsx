import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Search, Type } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { entitiesApi } from '@/api/entities'
import { useDebounce } from '@/hooks/useDebounce'
import { Modal } from '@/components/Modal/Modal'
import styles from './AssetPicker.module.css'

interface Props {
  kind: string            // entity | string | mesh | particle | texture | brush | sound | music | explosion | texanim
  value: string
  fieldKey?: string       // base key of the field, used to pre-filter entity pickers (ability -> Ability, ...)
  onPick: (value: string) => void
  onClose: () => void
}

interface Choice { name: string; detail?: string; badge?: string }

const LIMIT = 300
const KIND_LABEL: Record<string, string> = {
  entity: 'entity', string: 'string', mesh: 'mesh', particle: 'particle effect', texture: 'texture', brush: 'brush (UI image)',
  sound: 'sound effect', music: 'music track', explosion: 'explosion group', texanim: 'texture animation',
}
/** Which entity type a reference key normally points at; the user can widen it. */
const ENTITY_HINTS: Record<string, string> = {
  ability: 'Ability', buffType: 'Buff', buffTypeToRemove: 'Buff', fighterEntityDef: 'Fighter', fighterIllusionEntityDef: 'Fighter',
  squadTypeEntityDef: 'Squad', flagship: 'CapitalShip', Subject: 'ResearchSubject', ruinPlanetType: 'Planet', cargoShipType: 'Frigate',
}

/** Searchable chooser for reference fields; free text is always allowed. */
export function AssetPicker({ kind, value, fieldKey, onPick, onClose }: Props) {
  const [query, setQuery] = useState(value)
  const [typeFilter, setTypeFilter] = useState(() => (fieldKey && ENTITY_HINTS[fieldKey.split(':')[0]]) || '')
  const [cursor, setCursor] = useState(0)
  const debounced = useDebounce(query, 200)
  const listRef = useRef<HTMLUListElement>(null)

  const { data: types } = useQuery({ queryKey: ['entities', 'types'], queryFn: entitiesApi.types, enabled: kind === 'entity' })
  const { data, isFetching } = useQuery({
    queryKey: ['picker', kind, typeFilter, debounced],
    queryFn: async (): Promise<Choice[]> => {
      if (kind === 'entity') {
        const rows = await entitiesApi.list({ search: debounced || undefined, entity_type: typeFilter || undefined, limit: LIMIT })
        return rows.map((e) => ({ name: e.name, detail: [e.entityType, e.displayName].filter(Boolean).join(' · '), badge: e.faction ?? undefined }))
      }
      if (kind === 'string') {
        const res = await catalogApi.strings({ search: debounced || undefined, limit: LIMIT })
        return res.rows.map((s) => ({ name: s.stringId, detail: s.value }))
      }
      const rows = await catalogApi.assets({ kind, search: debounced || undefined, limit: LIMIT })
      return rows.map((a) => ({ name: a.name, detail: a.path ?? undefined, badge: a.source === 'vanilla' ? 'base game' : undefined }))
    },
    staleTime: 60_000,
  })
  const choices = useMemo(() => data ?? [], [data])
  const exact = choices.some((c) => c.name === query.trim())

  useEffect(() => { setCursor(0) }, [choices])
  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const pick = (v: string) => { const t = v.trim(); if (t) { onPick(t); onClose() } }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(choices.length - 1, c + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(choices[cursor]?.name ?? query) }
  }

  const footer = (
    <>
      <span className={styles.count}>{isFetching ? 'searching…' : `${choices.length}${choices.length === LIMIT ? '+' : ''} match(es)`}</span>
      <span className={styles.spacer} />
      <button type="button" className="btn sm" onClick={onClose}>Cancel</button>
      <button type="button" className="btn sm" disabled={!query.trim() || exact} onClick={() => pick(query)} title="Use exactly what you typed, even if nothing matches">
        <Type size={13} /> Use text
      </button>
    </>
  )

  return (
    <Modal title={`Choose ${KIND_LABEL[kind] ?? kind}`} onClose={onClose} footer={footer} width={620}>
      <div className={styles.searchRow}>
        <div className={styles.search}>
          <Search size={14} />
          <input type="search" value={query} autoFocus spellCheck={false} placeholder="Filter by name…"
                 onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} onFocus={(e) => e.target.select()} />
        </div>
        {kind === 'entity' && (
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} title="Entity type">
            <option value="">all types</option>
            {(types ?? []).map((t) => <option key={t.entityType} value={t.entityType}>{t.entityType}</option>)}
          </select>
        )}
      </div>
      <ul className={styles.list} ref={listRef}>
        {choices.map((c, i) => (
          <li key={c.name}>
            <button type="button" className={styles.item} data-active={i === cursor || undefined} data-current={c.name === value || undefined}
                    onMouseEnter={() => setCursor(i)} onClick={() => pick(c.name)}>
              <span className={styles.name}>{c.name}</span>
              {c.badge && <span className={styles.badge}>{c.badge}</span>}
              {c.detail && <span className={styles.detail} title={c.detail}>{c.detail}</span>}
              {c.name === value && <Check size={13} className={styles.check} />}
            </button>
          </li>
        ))}
        {!isFetching && choices.length === 0 && <li className={styles.empty}>Nothing indexed matches; you can still use the typed text.</li>}
      </ul>
    </Modal>
  )
}
