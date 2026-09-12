import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Crosshair, ExternalLink, Trash2, Unlink, X } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useUiStore, tabId } from '@/store/useUiStore'
import { toast } from '@/store/useToastStore'
import { portLabel } from '@/components/EntityGraphNode/EntityGraphNode'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import type { RelEdge, RelNode } from '@/types/api'
import styles from './RelationshipDetail.module.css'

interface Props {
  node: RelNode
  edges: RelEdge[]
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onClose: () => void
  onDisconnect: (source: string, port: string) => void
}

/** Side panel for the selected graph node: its links in both directions, focus, open, delete. */
export function RelationshipDetail({ node, edges, onSelect, onFocus, onClose, onDisconnect }: Props) {
  const qc = useQueryClient()
  const openEntity = useUiStore((s) => s.openEntity)
  const [confirm, setConfirm] = useState(false)
  const outgoing = edges.filter((e) => e.source === node.id)
  const incoming = edges.filter((e) => e.target === node.id)
  const remove = useMutation({
    mutationFn: () => entitiesApi.remove(node.id, true),
    onSuccess: (r) => {
      useUiStore.getState().closeTab(tabId({ kind: 'entity', name: node.id }))
      qc.invalidateQueries({ queryKey: ['graph'] }); qc.invalidateQueries({ queryKey: ['entities'] }); qc.invalidateQueries({ queryKey: ['diagnostics'] })
      toast.success(r.movedTo ? `Deleted ${node.id}; file moved to .sotp-trash` : `Deleted ${node.id}`)
      onClose()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <aside className={styles.root}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h3 className={styles.name}>{node.id}</h3>
          <p className={styles.meta}>{node.asset ? node.kind : node.entityType ?? 'missing'}{node.faction ? ` · ${node.race} ${node.faction}` : ''}{node.label !== node.id ? ` · ${node.label}` : ''}</p>
        </div>
        <button type="button" className={styles.icon} onClick={onClose} aria-label="Close"><X size={14} /></button>
      </header>
      {!node.exists && <p className={styles.warn}>Nothing defines this name: every link into it is a broken reference.</p>}
      {node.proxy && node.exists && !node.asset && <p className={styles.hint}>Outside the current pathway; shown because something here points at it.</p>}

      <h4 className={styles.sub}>Points at ({outgoing.length})</h4>
      <ul className={styles.links}>
        {outgoing.map((e) => (
          <li key={`${e.path}|${e.target}`} className={styles.link}>
            <span className={styles.port}>{portLabel(e.path, e.key)}</span>
            <button type="button" className={styles.target} data-missing={!e.resolved || undefined} onClick={() => onSelect(e.target)} title={e.path}>{e.target}</button>
            {e.kind === 'entity' && <button type="button" className={styles.icon} title="Disconnect (clears the field)" onClick={() => onDisconnect(e.source, e.path)}><Unlink size={12} /></button>}
          </li>
        ))}
        {node.ports.filter((p) => !p.target).map((p) => (
          <li key={p.path} className={styles.link}><span className={styles.port}>{portLabel(p.path, p.key)}</span><span className={styles.empty}>empty slot: drag from its port</span></li>
        ))}
        {!outgoing.length && !node.ports.length && <li className={styles.empty}>nothing</li>}
      </ul>

      <h4 className={styles.sub}>Pointed at by ({incoming.length})</h4>
      <ul className={styles.links}>
        {incoming.map((e) => (
          <li key={`${e.source}|${e.path}`} className={styles.link}>
            <button type="button" className={styles.target} onClick={() => onSelect(e.source)} title={e.path}>{e.source}</button>
            <span className={styles.port}>{portLabel(e.path, e.key)}</span>
          </li>
        ))}
        {!incoming.length && <li className={styles.empty}>nothing in this view</li>}
      </ul>

      {node.exists && !node.asset && (
        <div className={styles.actions}>
          <button type="button" className="btn sm" onClick={() => onFocus(node.id)}><Crosshair size={12} /> Focus here</button>
          <button type="button" className="btn sm primary" onClick={() => openEntity(node.id)}><ExternalLink size={12} /> Open</button>
          <span className={styles.spacer} />
          <button type="button" className="btn sm danger" onClick={() => setConfirm(true)} title="Delete this entity from the project"><Trash2 size={12} /></button>
        </div>
      )}
      {confirm && (
        <ConfirmDialog title="Delete entity" confirmLabel="Delete" danger busy={remove.isPending} onCancel={() => setConfirm(false)}
                       onConfirm={() => remove.mutate(undefined, { onSettled: () => setConfirm(false) })}>
          <p>Remove <code>{node.id}</code> from the project?</p>
          <p className="muted">Its file (if written) is moved to <code>.sotp-trash/</code>; the {incoming.length} link(s) into it become broken references you can see here.</p>
        </ConfirmDialog>
      )}
    </aside>
  )
}
