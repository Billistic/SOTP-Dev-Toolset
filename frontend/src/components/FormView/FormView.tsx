import { useMemo } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Crosshair, Scale } from 'lucide-react'
import { FieldRow } from '@/components/FieldRow/FieldRow'
import { FormSection } from '@/components/FormSection/FormSection'
import { useUiStore } from '@/store/useUiStore'
import { findNode, isBlock, statValue } from '@/utils/tree'
import { fmtNum, humanKey } from '@/utils/format'
import type { EditChange, EntityDetail, FieldSpec } from '@/types/api'
import styles from './FormView.module.css'

interface Props {
  entity: EntityDetail
  onEdit: (changes: EditChange[]) => void
  busy?: boolean
}

const GROUP_ORDER = ['Identity', 'Economy', 'Durability', 'Mobility', 'Combat', 'Fleet', 'Research', 'Planet', 'Module',
  'Squad', 'Ability', 'Visual', 'Audio', 'Text', 'AI', 'Other']
const OTHERS = 'Other fields'
const WEAPONS = 'Weapons'

/** Schema-driven form: one collapsible tile per group, then every remaining top-level scalar as a generic field. */
export function FormView({ entity, onEdit, busy }: Props) {
  const root = entity.tree.root
  const collapsed = useUiStore((s) => s.collapsedGroups)
  const toggleGroup = useUiStore((s) => s.toggleGroup)
  const setGroups = useUiStore((s) => s.setGroups)
  const setEditorMode = useUiStore((s) => s.setEditorMode)
  const weaponCount = root.filter((n) => n.k === 'Weapon').length
  const carriesWeapons = weaponCount > 0 || root.some((n) => n.k === 'NumWeapons')

  const resolved = useMemo(() => entity.schema.fields.map((spec) => {
    if (spec.kind === 'stat') {
      const hit = statValue(root, spec.path)
      return { spec, path: hit?.path ?? spec.path, raw: hit?.node.v }
    }
    const node = findNode(root, spec.path)
    return { spec, path: spec.path, raw: node && !isBlock(node) ? node.v : undefined }
  }), [entity.schema.fields, root])

  const covered = useMemo(() => new Set(resolved.map((r) => r.path.split('.')[0].split('[')[0])), [resolved])
  const others = useMemo(() => root.filter((n) => !isBlock(n) && !covered.has(n.k.split(':')[0]) && n.k !== 'entityType'), [root, covered])

  const groups = GROUP_ORDER.map((g) => ({ name: g, fields: resolved.filter((r) => r.spec.group === g) })).filter((g) => g.fields.length)
  const present = groups.map((g) => ({ ...g, fields: g.fields.filter((f) => f.raw !== undefined) })).filter((g) => g.fields.length)
  const absentCount = resolved.filter((r) => r.raw === undefined).length
  const names = [...present.map((g) => g.name), ...(carriesWeapons ? [WEAPONS] : []), ...(others.length ? [OTHERS] : [])]
  const allCollapsed = names.length > 0 && names.every((n) => collapsed.includes(n))

  const commit = (path: string) => (value: unknown) => onEdit([{ op: 'set', path, value }])

  return (
    <div className={styles.root}>
      {names.length === 0 && <p className={styles.hint}>No schema fields for {entity.entityType}; use the Tree view.</p>}
      {names.length > 0 && (
        <div className={styles.toolbar}>
          <span className={styles.legend}><Scale size={11} /> affects balance metrics</span>
          <button type="button" className={styles.toolBtn} onClick={() => setGroups(names, !allCollapsed)} title={allCollapsed ? 'Expand all sections' : 'Collapse all sections'}>
            {allCollapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
            {allCollapsed ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      )}
      <div className={styles.columns}>
        {present.map((g) => (
          <FormSection key={g.name} title={g.name} count={g.fields.length} balanceCount={g.fields.filter((f) => f.spec.balance).length}
                       collapsed={collapsed.includes(g.name)} onToggle={() => toggleGroup(g.name)}>
            {g.fields.map((f) => (
              <FieldRow key={f.path} spec={f.spec} path={f.path} raw={f.raw} entityType={entity.entityType} onCommit={commit(f.path)} busy={busy} />
            ))}
          </FormSection>
        ))}
        {carriesWeapons && (
          <FormSection title={WEAPONS} count={weaponCount} balanceCount={weaponCount ? 1 : 0} collapsed={collapsed.includes(WEAPONS)} onToggle={() => toggleGroup(WEAPONS)}>
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
        )}
        {others.length > 0 && (
          <FormSection title={OTHERS} count={others.length} collapsed={collapsed.includes(OTHERS)} onToggle={() => toggleGroup(OTHERS)}>
            {others.map((n) => (
              <FieldRow key={n.k} spec={genericSpec(n.k)} path={n.k} raw={n.v} entityType={entity.entityType} onCommit={commit(n.k)} busy={busy} />
            ))}
          </FormSection>
        )}
      </div>
      {absentCount > 0 && <p className={styles.hint}>{absentCount} schema field(s) are not present in this file.</p>}
    </div>
  )
}

function genericSpec(key: string): Pick<FieldSpec, 'label' | 'kind' | 'ref' | 'enum' | 'unit' | 'help' | 'balance'> {
  return { label: humanKey(key.split(':')[0]) + (key.includes(':') ? ` ${key.split(':').slice(1).join(':')}` : ''), kind: 'string', ref: null, enum: null, unit: null, help: null, balance: false }
}
