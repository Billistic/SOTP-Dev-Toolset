import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useDebounce } from '@/hooks/useDebounce'
import { useUiStore } from '@/store/useUiStore'
import { factionColor } from '@/utils/format'
import { NewEntityDialog } from '@/components/NewEntityDialog/NewEntityDialog'
import type { EntitySummary } from '@/types/api'
import styles from './EntityTree.module.css'

const CATEGORY_ORDER = ['ship', 'squad', 'module', 'research', 'planet', 'ability', 'buff', 'player', 'other']
const CATEGORY_LABEL: Record<string, string> = {
  ship: 'Ships', squad: 'Squads', module: 'Planet modules', research: 'Research', planet: 'Planets',
  ability: 'Abilities', buff: 'Buffs', player: 'Players', other: 'Other',
}

type Group = { key: string; label: string; items: EntitySummary[]; children?: Group[] }

function groupEntities(list: EntitySummary[]): Group[] {
  const byCat = new Map<string, Map<string, Map<string, EntitySummary[]>>>()
  for (const e of list) {
    const cat = byCat.get(e.category) ?? new Map()
    byCat.set(e.category, cat)
    const type = cat.get(e.entityType) ?? new Map()
    cat.set(e.entityType, type)
    const fac = e.faction ?? 'Shared'
    type.set(fac, [...(type.get(fac) ?? []), e])
  }
  return [...byCat.entries()]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]))
    .map(([cat, types]) => ({
      key: cat, label: CATEGORY_LABEL[cat] ?? cat, items: [],
      children: [...types.entries()].sort().map(([type, facs]) => ({
        key: `${cat}/${type}`, label: type, items: [],
        children: [...facs.entries()].sort().map(([fac, items]) => ({ key: `${cat}/${type}/${fac}`, label: fac, items })),
      })),
    }))
}

const count = (g: Group): number => g.items.length + (g.children?.reduce((n, c) => n + count(c), 0) ?? 0)
const errors = (g: Group): number => g.items.reduce((n, e) => n + e.errorCount, 0) + (g.children?.reduce((n, c) => n + errors(c), 0) ?? 0)

export function EntityTree() {
  const [search, setSearch] = useState('')
  const [onlyErrors, setOnlyErrors] = useState(false)
  const [onlyDirty, setOnlyDirty] = useState(false)
  const [creating, setCreating] = useState(false)
  const [open, setOpen] = useState<Set<string>>(() => new Set(['ship', 'ship/CapitalShip', 'ship/Frigate']))
  const debounced = useDebounce(search)
  const openEntity = useUiStore((s) => s.openEntity)
  const activeTab = useUiStore((s) => s.activeTab)

  const { data, isLoading } = useQuery({
    queryKey: ['entities', 'list', debounced, onlyErrors, onlyDirty],
    queryFn: () => entitiesApi.list({ search: debounced || undefined, errors: onlyErrors || undefined, dirty: onlyDirty || undefined }),
    retry: false,
  })
  const groups = useMemo(() => groupEntities(data ?? []), [data])
  const searching = debounced.length > 0

  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  const renderGroup = (g: Group, depth: number) => {
    const expanded = searching || open.has(g.key)
    const errs = errors(g)
    return (
      <li key={g.key}>
        <button className={styles.group} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggle(g.key)} aria-expanded={expanded}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className={styles.groupLabel}>{g.label}</span>
          {errs > 0 && <span className={styles.errBadge}>{errs}</span>}
          <span className={styles.count}>{count(g)}</span>
        </button>
        {expanded && (
          <ul>
            {g.children?.map((c) => renderGroup(c, depth + 1))}
            {g.items.map((e) => {
              const active = activeTab === `entity:${e.name}`
              return (
                <li key={e.id}>
                  <button className={styles.item} data-active={active || undefined} style={{ paddingLeft: 26 + depth * 12 }}
                          onClick={() => openEntity(e.name)} title={e.displayName ? `${e.displayName}\n${e.sourcePath}` : e.sourcePath}>
                    <span className={styles.swatch} style={{ background: factionColor(e.race) }} />
                    <span className={styles.name}>{e.name}</span>
                    {e.isDirty && <span className={styles.dirty} title="Unsaved" />}
                    {e.errorCount > 0 && <span className={styles.errDot} title={`${e.errorCount} error(s)`} />}
                    {e.errorCount === 0 && e.warningCount > 0 && <span className={styles.warnDot} title={`${e.warningCount} warning(s)`} />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <Search size={14} />
          <input type="search" data-bare placeholder="Search entities…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className={styles.filters}>
          <label><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> errors</label>
          <label><input type="checkbox" checked={onlyDirty} onChange={(e) => setOnlyDirty(e.target.checked)} /> unsaved</label>
          <span className={styles.spacer} />
          <button type="button" className={styles.newBtn} onClick={() => setCreating(true)} title="New entity (copy of an existing one)"><Plus size={13} /> New</button>
        </div>
      </div>
      {creating && <NewEntityDialog onClose={() => setCreating(false)} />}
      <ul className={styles.tree}>
        {isLoading && <li className={styles.hint}>Loading…</li>}
        {!isLoading && !groups.length && <li className={styles.hint}>No entities. Ingest a project first.</li>}
        {groups.map((g) => renderGroup(g, 0))}
      </ul>
    </div>
  )
}
