import { memo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { ChevronRight, FolderOpen } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useGraphEdits } from '@/hooks/useGraphEdits'
import { useGraphStore } from '@/store/useGraphStore'
import { factionColor } from '@/utils/format'
import { AssetPicker } from '@/components/AssetPicker/AssetPicker'
import { KIND_LABEL, KIND_ORDER } from '@/utils/assetKinds'
import type { Reference, RelNode } from '@/types/api'
import styles from './EntityGraphNode.module.css'

export interface EntityGraphNodeData extends Record<string, unknown> {
  node: RelNode
  selected: boolean
  focus: boolean
}

/** Short port label: ``Prerequisites.ResearchPrerequisite[1].Subject`` -> ``prereq 2``, ``ability:0`` -> ``ability 1``. */
export function portLabel(path: string, key: string) {
  const m = /ResearchPrerequisite(?:\[(\d+)\])?\.Subject$/.exec(path)
  if (m) return `prereq ${Number(m[1] ?? 0) + 1}`
  const idx = /:(\d+)$/.exec(path)
  return idx ? `${key} ${Number(idx[1]) + 1}` : key
}

/** ``Weapon[2].WeaponEffects.muzzleEffectName`` -> ``weapon 3 · muzzleEffectName``: where inside the file an asset field sits. */
export function assetFieldLabel(path: string, key: string) {
  const parts = path.split('.')
  const ctx = parts.slice(0, -1).map((p) => { const m = /^(\w+)(?:\[(\d+)\])?$/.exec(p); return m ? (m[2] !== undefined ? `${m[1].toLowerCase()} ${Number(m[2]) + 1}` : m[1]) : p })
  return ctx.length ? `${ctx.join(' › ')} · ${key}` : key
}

/**
 * Builder node: one input on the left (anything may point at this entity), one output per entity
 * reference on the right, and an Assets section below - one row per kind (meshes, sounds...) that
 * expands into the actual fields with a picker to change them, UE-style inline asset properties.
 * When a kind is toggled on in the toolbar its row also carries the port the asset wires leave from.
 */
export const EntityGraphNode = memo(function EntityGraphNode({ data }: NodeProps<Node<EntityGraphNodeData>>) {
  const { node, selected, focus } = data
  const acceptsPrereq = node.category === 'research' || node.category === 'ship' || node.category === 'module' || node.category === 'squad'
  const kinds = KIND_ORDER.filter((k) => (node.assetCounts?.[k] ?? 0) > 0)
  const wired = useGraphStore((s) => s.assetKinds)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className={styles.node} data-selected={selected || undefined} data-focus={focus || undefined}
         data-errors={(node.errors ?? 0) > 0 || undefined} data-missing={!node.exists || undefined}
         style={{ '--band': `var(--node-${node.category ?? 'other'}, var(--node-other))` } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} id="in" className={styles.inHandle} />
      <header className={styles.head}>
        <span className={styles.swatch} style={{ background: factionColor(node.race ?? null) }} />
        <span className={styles.name} title={node.id}>{node.id}</span>
      </header>
      <div className={styles.sub}>
        <span className={styles.type}>{node.entityType}</span>
        {node.label !== node.id && <span className={styles.display} title={node.label}>{node.label}</span>}
        {node.dirty && <span className={styles.dirty} title="Unsaved edits" />}
      </div>
      <ul className={styles.ports}>
        {(node.ports ?? []).map((p) => (
          <li key={p.path} className={styles.port} data-empty={!p.target || undefined} title={`${p.path}${p.target ? ` = ${p.target}` : ' (empty)'}`}>
            <span className={styles.portLabel}>{portLabel(p.path, p.key)}</span>
            <Handle type="source" position={Position.Right} id={p.path} className={styles.outHandle} />
          </li>
        ))}
        {acceptsPrereq && (
          <li className={`${styles.port} ${styles.portNew}`} title="Drag to a research subject to add a prerequisite">
            <span className={styles.portLabel}>+ prerequisite</span>
            <Handle type="source" position={Position.Right} id="prerequisite" className={styles.outHandle} />
          </li>
        )}
      </ul>
      {kinds.length > 0 && (
        <div className={styles.assets}>
          {kinds.map((k) => (
            <AssetKindRow key={k} entity={node.id} kind={k} count={node.assetCounts![k]} wired={wired.includes(k)}
                          open={open === k} onToggle={() => setOpen(open === k ? null : k)} />
          ))}
        </div>
      )}
    </div>
  )
})

/** One asset kind on a node: the count row (with the wire port when that kind is shown), expanding into editable fields. */
function AssetKindRow({ entity, kind, count, wired, open, onToggle }: { entity: string; kind: string; count: number; wired: boolean; open: boolean; onToggle: () => void }) {
  const { data: refs } = useQuery({ queryKey: ['entity', entity, 'references'], queryFn: () => entitiesApi.references(entity), enabled: open, staleTime: 30_000 })
  const { connect } = useGraphEdits()
  const [picking, setPicking] = useState<Reference | null>(null)
  const rows = (refs ?? []).filter((r) => r.kind === kind)
  const broken = rows.filter((r) => !r.resolved).length
  return (
    <div className={styles.kind} data-open={open || undefined} data-wired={wired || undefined}>
      <button type="button" className={`${styles.kindHead} nodrag`} onClick={(e) => { e.stopPropagation(); onToggle() }}
              title={`${count} ${KIND_LABEL[kind] ?? kind}${wired ? ' · wires leave from this row' : ''} - click to list and edit`}>
        <ChevronRight size={11} className={styles.chev} data-open={open || undefined} />
        <span className={styles.kindLabel}>{KIND_LABEL[kind] ?? kind}</span>
        <span className={styles.kindCount}>{count}</span>
        {open && broken > 0 && <span className={styles.kindBroken} title={`${broken} unresolved`}>{broken} missing</span>}
      </button>
      {wired && <Handle type="source" position={Position.Right} id={`assets:${kind}`} className={styles.assetHandle} isConnectable={false} />}
      {open && (
        <ul className={`${styles.fields} nodrag nowheel`}>
          {rows.map((r) => (
            <li key={r.path} className={styles.field} data-missing={!r.resolved || undefined} title={`${r.path}\n${r.target}${r.resolved ? '' : '\nnot found in the mod' + (r.resolvedSource ? '' : ' or the base game')}`}>
              <span className={styles.fieldKey}>{assetFieldLabel(r.path, r.key)}</span>
              <span className={styles.fieldValue}>{r.target || <i>empty</i>}</span>
              <button type="button" className={styles.pick} onClick={(e) => { e.stopPropagation(); setPicking(r) }} title={`Choose another ${kind}`}><FolderOpen size={11} /></button>
            </li>
          ))}
          {refs && rows.length === 0 && <li className={styles.fieldEmpty}>none</li>}
          {!refs && <li className={styles.fieldEmpty}>loading…</li>}
        </ul>
      )}
      {picking && (
        <AssetPicker kind={kind} value={picking.target} fieldKey={picking.key} onClose={() => setPicking(null)}
                     onPick={(v) => { if (v !== picking.target) connect(entity, picking.path, v, picking.target) }} />
      )}
    </div>
  )
}
