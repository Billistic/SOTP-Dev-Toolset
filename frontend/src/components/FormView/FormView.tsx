import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronsDownUp, ChevronsUpDown, Crosshair, Scale } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { BlockBody } from '@/components/BlockBody/BlockBody'
import { FieldRow } from '@/components/FieldRow/FieldRow'
import { FormSection } from '@/components/FormSection/FormSection'
import { useUiStore } from '@/store/useUiStore'
import { findNode, isBlock, statValue } from '@/utils/tree'
import { fmtNum, humanKey } from '@/utils/format'
import { GROUP_ORDER, planForm, tileStats } from '@/utils/formPlan'
import type { EditChange, EntityDetail, FieldSpec } from '@/types/api'
import styles from './FormView.module.css'

interface Props {
  entity: EntityDetail
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

const OTHERS = 'Other fields'
const WEAPONS = 'Weapons'

/**
 * One form, one place per field: the Rebellion grammar supplies every field and block of the file, the
 * curated specs supply labels, units, balance flags and the group each root field belongs to, and
 * ``planForm`` folds the two into tiles - curated groups, repeated blocks as one tile each, big blocks
 * as their own tile, small ones inline.  Entity types outside the grammar fall back to the curated
 * groups plus a generic tile of leftover top-level values.
 */
export function FormView({ entity, onEdit, busy }: Props) {
  const root = entity.tree.root
  const collapsed = useUiStore((s) => s.collapsedGroups)
  const toggleGroup = useUiStore((s) => s.toggleGroup)
  const setGroups = useUiStore((s) => s.setGroups)
  const setEditorMode = useUiStore((s) => s.setEditorMode)
  const weaponCount = root.filter((n) => n.k === 'Weapon').length
  const carriesWeapons = weaponCount > 0 || root.some((n) => n.k === 'NumWeapons')
  const { data: layout } = useQuery({ queryKey: ['entity', entity.name, 'layout'], queryFn: () => entitiesApi.layout(entity.name), placeholderData: (p) => p })

  const resolved = useMemo(() => entity.schema.fields.map((spec) => {
    if (spec.kind === 'stat') {
      const hit = statValue(root, spec.path)
      return { spec, path: hit?.path ?? spec.path, raw: hit?.node.v }
    }
    const node = findNode(root, spec.path)
    return { spec, path: spec.path, raw: node && !isBlock(node) ? node.v : undefined }
  }), [entity.schema.fields, root])

  const grammar = layout?.known ? layout : null
  const tiles = useMemo(() => (grammar ? planForm(grammar, resolved, carriesWeapons) : []), [grammar, resolved, carriesWeapons])
  const commit = (path: string) => (value: unknown) => onEdit([{ op: 'set', path, value }])

  // fallback for entity types the grammar does not describe
  const coveredKeys = useMemo(() => new Set(resolved.map((r) => r.path.split('.')[0].split('[')[0])), [resolved])
  const others = useMemo(() => root.filter((n) => !isBlock(n) && !coveredKeys.has(n.k.split(':')[0]) && n.k !== 'entityType'), [root, coveredKeys])
  const fallbackGroups = GROUP_ORDER.map((g) => ({ name: g, fields: resolved.filter((r) => r.spec.group === g && r.raw !== undefined) })).filter((g) => g.fields.length)

  const names = grammar ? tiles.map((t) => t.key) : [...fallbackGroups.map((g) => g.name), ...(carriesWeapons ? [WEAPONS] : []), ...(others.length ? [OTHERS] : [])]
  const allCollapsed = names.length > 0 && names.every((n) => collapsed.includes(n))
  const totals = useMemo(() => tileStats(tiles.flatMap((t) => t.items)), [tiles])

  const weaponsTile = (key: string) => (
    <FormSection key={key} title={WEAPONS} count={weaponCount} balanceCount={weaponCount ? 1 : 0} collapsed={collapsed.includes(key)} onToggle={() => toggleGroup(key)}>
      <div className={styles.weapons}>
        {entity.weapons.map((w) => (
          <div key={w.weapon_index} className={styles.weaponRow}>
            <span className={styles.weaponIdx}>#{w.weapon_index}</span>
            <span className={styles.weaponType}>{w.weapon_type}</span>
            <span className="muted">{w.attack_type}</span>
            <span className={styles.weaponStat}>DPS {fmtNum(w.dps_best_bank)}</span>
            <span className={styles.weaponStat}>range {fmtNum(w.range ?? 0)}</span>
          </div>
        ))}
        {weaponCount === 0 && <p className={styles.hint}>No weapons on this hull yet.</p>}
        <button type="button" className="btn sm" onClick={() => setEditorMode('weapons')}><Crosshair size={13} /> Open weapons editor</button>
      </div>
    </FormSection>
  )

  return (
    <div className={styles.root}>
      {names.length === 0 && <p className={styles.hint}>No fields to show for {entity.entityType}; use the Tree view.</p>}
      {names.length > 0 && (
        <div className={styles.toolbar}>
          <span className={styles.legend}>
            <Scale size={11} /> affects balance metrics
            {grammar && (
              <span className={styles.grammarNote}>
                · {totals.present} fields in {tiles.length} tiles{totals.warn ? ` · ${totals.warn} to look at` : ' · grammar-clean'}
              </span>
            )}
          </span>
          <button type="button" className={styles.toolBtn} onClick={() => setGroups(names, !allCollapsed)} title={allCollapsed ? 'Expand all sections' : 'Collapse all sections'}>
            {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      )}
      <div className={styles.columns}>
        {grammar && tiles.map((t) => {
          if (t.kind === 'weapons') return weaponsTile(t.key)
          const stats = tileStats(t.items)
          return (
            <FormSection key={t.key} title={t.title} subtitle={t.subtitle} count={stats.present} balanceCount={stats.balance} warnCount={stats.warn}
                         collapsed={collapsed.includes(t.key)} onToggle={() => toggleGroup(t.key)}>
              <BlockBody items={t.items} entityType={entity.entityType} onEdit={onEdit} busy={busy} removableBlocks={t.kind === 'repeat'} />
            </FormSection>
          )
        })}
        {!grammar && fallbackGroups.map((g) => (
          <FormSection key={g.name} title={g.name} count={g.fields.length} balanceCount={g.fields.filter((f) => f.spec.balance).length}
                       collapsed={collapsed.includes(g.name)} onToggle={() => toggleGroup(g.name)}>
            {g.fields.map((f) => (
              <FieldRow key={f.path} spec={f.spec} path={f.path} raw={f.raw} entityType={entity.entityType} onCommit={commit(f.path)} busy={busy} />
            ))}
          </FormSection>
        ))}
        {!grammar && carriesWeapons && weaponsTile(WEAPONS)}
        {!grammar && others.length > 0 && (
          <FormSection title={OTHERS} count={others.length} collapsed={collapsed.includes(OTHERS)} onToggle={() => toggleGroup(OTHERS)}>
            {others.map((n) => (
              <FieldRow key={n.k} spec={genericSpec(n.k)} path={n.k} raw={n.v} entityType={entity.entityType} onCommit={commit(n.k)} busy={busy} />
            ))}
          </FormSection>
        )}
      </div>
      {layout && !layout.known && <p className={styles.hint}>{entity.entityType} is not in the Rebellion grammar tables; only the curated fields and top-level values are shown here - use the Tree view for the rest.</p>}
    </div>
  )
}

function genericSpec(key: string): Pick<FieldSpec, 'label' | 'kind' | 'ref' | 'enum' | 'unit' | 'help' | 'balance'> {
  return { label: humanKey(key.split(':')[0]) + (key.includes(':') ? ` ${key.split(':').slice(1).join(':')}` : ''), kind: 'string', ref: null, enum: null, unit: null, help: null, balance: false }
}
