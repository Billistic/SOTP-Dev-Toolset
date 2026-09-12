import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { ArrowUpRight, Box } from 'lucide-react'
import type { RelNode } from '@/types/api'
import styles from './ProxyGraphNode.module.css'

export interface ProxyGraphNodeData extends Record<string, unknown> {
  node: RelNode
  selected: boolean
  inCount?: number
}

/**
 * Reference stub for something outside the current filter (or an asset / missing target):
 * the pipeline continues here; expanding it pulls the real node into the view.
 */
export const ProxyGraphNode = memo(function ProxyGraphNode({ data }: NodeProps<Node<ProxyGraphNodeData>>) {
  const { node, selected, inCount = 0 } = data
  return (
    <div className={styles.node} data-selected={selected || undefined} data-missing={!node.exists || undefined} data-asset={node.asset || undefined} data-hub={inCount >= 6 || undefined}
         title={node.exists ? (node.asset ? `${node.kind}: ${node.id}` : `${node.entityType ?? 'entity'} outside this view - click to expand`) : `${node.id} does not exist`}>
      <Handle type="target" position={Position.Left} id="in" className={styles.handle} />
      {node.asset ? <Box size={11} className={styles.icon} /> : <ArrowUpRight size={11} className={styles.icon} />}
      <span className={styles.name}>{node.id}</span>
      <span className={styles.kind}>{node.asset ? node.kind : node.exists ? node.entityType : 'missing'}</span>
      {inCount > 1 && <span className={styles.count} title={`${inCount} links point here`}>{inCount}</span>}
      <Handle type="source" position={Position.Right} id="out" className={styles.handle} />
    </div>
  )
})
