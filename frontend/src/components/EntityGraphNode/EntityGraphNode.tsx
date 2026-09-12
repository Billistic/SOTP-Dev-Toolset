import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { factionColor } from '@/utils/format'
import type { RelNode } from '@/types/api'
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

/**
 * Builder node: one input on the left (anything may point at this entity) and one
 * output per reference field on the right; empty slots show as hollow ports.
 */
export const EntityGraphNode = memo(function EntityGraphNode({ data }: NodeProps<Node<EntityGraphNodeData>>) {
  const { node, selected, focus } = data
  const acceptsPrereq = node.category === 'research' || node.category === 'ship' || node.category === 'module' || node.category === 'squad'
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
        {node.ports.map((p) => (
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
    </div>
  )
})
