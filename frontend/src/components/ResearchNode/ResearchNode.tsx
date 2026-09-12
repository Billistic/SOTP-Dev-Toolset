import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { GraphNode } from '@/types/api'
import styles from './ResearchNode.module.css'

export interface ResearchNodeData extends Record<string, unknown> {
  node: GraphNode
  unlocks: number
  selected: boolean
}

export const ResearchNode = memo(function ResearchNode({ data }: NodeProps<Node<ResearchNodeData>>) {
  const { node, unlocks, selected } = data
  return (
    <div className={styles.node} data-selected={selected || undefined} data-missing={!node.exists || undefined} data-errors={(node.errors ?? 0) > 0 || undefined}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.tier}>T{node.tier ?? '?'}</div>
      <div className={styles.label} title={node.id}>{node.label}</div>
      <div className={styles.meta}>
        {node.levels && node.levels > 1 ? <span>{node.levels} lv</span> : null}
        {unlocks > 0 && <span>{unlocks} unlock{unlocks > 1 ? 's' : ''}</span>}
        {!node.exists && <span className={styles.bad}>missing</span>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  )
})
