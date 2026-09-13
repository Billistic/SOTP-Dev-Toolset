import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Box, ChevronDown, ChevronUp } from 'lucide-react'
import { KIND_LABEL } from '@/utils/assetKinds'
import styles from './AssetGraphNode.module.css'

export const ASSET_W = 210
export const ASSET_H = 24

export interface AssetGraphNodeData extends Record<string, unknown> {
  name: string
  kind: string
  exists: boolean
  count: number                                    // fields on the fanned-out entity that reference this asset
  selected: boolean
  more?: { hidden: number; expanded: boolean }     // the fold chip closing a long group: click to show the rest
}

/** A mesh / particle / sound... fanned out from the selected entity: a light chip with one input and no ports of its own. */
export const AssetGraphNode = memo(function AssetGraphNode({ data }: NodeProps<Node<AssetGraphNodeData>>) {
  const { name, kind, exists, count, selected, more } = data
  const label = KIND_LABEL[kind] ?? kind
  const title = more
    ? (more.expanded ? `Fold the ${label} back to the first few` : `${more.hidden} more ${label} - click to show them all`)
    : `${kind}: ${name}${exists ? '' : ' (not found in the mod or the base game)'}${count > 1 ? `\nreferenced by ${count} fields` : ''}`
  return (
    <div className={styles.chip} data-selected={selected || undefined} data-missing={!exists || undefined} data-more={more ? '' : undefined} title={title}>
      <Handle type="target" position={Position.Left} id="in" className={styles.handle} isConnectable={false} />
      {more ? (more.expanded ? <ChevronUp size={11} className={styles.icon} /> : <ChevronDown size={11} className={styles.icon} />) : <Box size={11} className={styles.icon} />}
      <span className={styles.name}>{more ? (more.expanded ? `show fewer ${label}` : `+${more.hidden} more ${label}`) : name}</span>
      {count > 1 && <span className={styles.count} title={`${count} fields reference this ${kind}`}>×{count}</span>}
      {!more && <span className={styles.kind}>{exists ? kind : 'missing'}</span>}
    </div>
  )
})
