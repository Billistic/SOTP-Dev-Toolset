import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Clock, Coins, Unlock } from 'lucide-react'
import { fmtNum } from '@/utils/format'
import { tierColor } from '@/components/ResearchGraphView/ResearchGraphView'
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
    <div className={styles.node} data-selected={selected || undefined} data-missing={!node.exists || undefined} data-errors={(node.errors ?? 0) > 0 || undefined}
         style={{ '--band': tierColor(node.tier) } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className={styles.handle} />
      <div className={styles.label} title={node.id}>
        <span className={styles.name}>{node.label}</span>
        <span className={styles.tier}>T{node.tier ?? '?'}</span>
      </div>
      <div className={styles.meta}>
        {node.cost != null && <span title="Total cost"><Coins size={10} /> {fmtNum(node.cost, 0)}</span>}
        {node.time != null && <span title="Research time"><Clock size={10} /> {fmtNum(node.time, 0)}s</span>}
        {node.levels && node.levels > 1 ? <span>{node.levels} lv</span> : null}
        {unlocks > 0 && <span className={styles.unlocks} title={`${unlocks} unit(s) unlocked`}><Unlock size={10} /> {unlocks}</span>}
        {!node.exists && <span className={styles.bad}>missing</span>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} />
    </div>
  )
})
