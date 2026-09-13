import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CornerUpLeft, Crosshair, ExternalLink, EyeOff, Trash2, Unlink, X } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useUiStore, tabId } from '@/store/useUiStore'
import { toast } from '@/store/useToastStore'
import { assetFieldLabel, portLabel } from '@/components/EntityGraphNode/EntityGraphNode'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import type { RelEdge, RelNode } from '@/types/api'
import styles from './RelationshipDetail.module.css'

interface Props {
  node: RelNode
  edges: RelEdge[]                   // entity links for an entity; the referencing fields for a fanned-out asset
  onSelect: (id: string) => void
  onFocus: (id: string) => void
  onClose: () => void
  onDisconnect: (source: string, port: string, edge?: { target: string; level?: number | null }) => void
  added?: boolean                    // brought into the scene by hand (Add existing / expanded proxy)
  onRemoveFromScene?: () => void
}

/** Fanned-out assets are graph nodes ``asset:<anchor>:<kind>:<name>``; people see the name. */
export const shown = (id: string) => id.replace(/^asset:[^:]+:[^:]+:/, '')
const LINKS_KEY = 'sotp-rel-links'   // whether the Links section is unfolded; remembered across selections

/**
 * Side panel for the selected graph node.  Deliberately thin: name, a line of context, the actions - the
 * node itself and its wires already show the links, and Open is where the detail lives.  The entity link
 * lists stay one click away (Links) for unlinking and jumping.  A selected asset chip lists the fields on
 * its entity that reference it, which is the one thing the chip cannot show.
 */
export function RelationshipDetail({ node, edges, onSelect, onFocus, onClose, onDisconnect, added, onRemoveFromScene }: Props) {
  const qc = useQueryClient()
  const openEntity = useUiStore((s) => s.openEntity)
  const [confirm, setConfirm] = useState(false)
  const [links, setLinks] = useState(() => { try { return localStorage.getItem(LINKS_KEY) === '1' } catch { return false } })
  useEffect(() => { try { localStorage.setItem(LINKS_KEY, links ? '1' : '0') } catch { /* private mode */ } }, [links])
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

  if (node.asset) {
    const anchor = incoming[0]?.source
    return (
      <aside className={styles.root}>
        <header className={styles.head}>
          <div className={styles.titles}>
            <h3 className={styles.name}>{shown(node.id)}</h3>
            <p className={styles.meta}>{node.kind}{anchor ? ` · ${incoming.length} field${incoming.length === 1 ? '' : 's'} of ${anchor}` : ''}</p>
          </div>
          <button type="button" className={styles.icon} onClick={onClose} aria-label="Close"><X size={14} /></button>
        </header>
        {!node.exists && <p className={styles.warn}>No {node.kind} with this name is indexed (mod or base game); these fields are broken references.</p>}
        <ul className={styles.fields}>
          {incoming.map((e) => <li key={e.path} className={styles.field} title={e.path}>{assetFieldLabel(e.path, e.key)}</li>)}
        </ul>
        {anchor && (
          <div className={styles.actions}>
            <button type="button" className="btn sm" onClick={() => onSelect(anchor)} title="Back to the entity these fields belong to"><CornerUpLeft size={12} /> {anchor}</button>
          </div>
        )}
      </aside>
    )
  }

  return (
    <aside className={styles.root}>
      <header className={styles.head}>
        <div className={styles.titles}>
          <h3 className={styles.name}>{node.id}</h3>
          <p className={styles.meta}>{node.entityType ?? 'missing'}{node.faction ? ` · ${node.race} ${node.faction}` : ''}{node.label !== node.id ? ` · ${node.label}` : ''}</p>
        </div>
        <button type="button" className={styles.icon} onClick={onClose} aria-label="Close"><X size={14} /></button>
      </header>
      {!node.exists && <p className={styles.warn}>Nothing defines this name: every link into it is a broken reference.</p>}
      {node.proxy && node.exists && <p className={styles.hint}>Outside the current pathway - click the node to expand it.</p>}

      {node.exists && (
        <div className={styles.actions}>
          <button type="button" className="btn sm" onClick={() => onFocus(node.id)}><Crosshair size={12} /> Focus here</button>
          <button type="button" className="btn sm primary" onClick={() => openEntity(node.id)}><ExternalLink size={12} /> Open</button>
          <span className={styles.spacer} />
          {added && onRemoveFromScene && <button type="button" className="btn sm" onClick={onRemoveFromScene} title="Take this node out of the scene (the entity itself is untouched)"><EyeOff size={12} /></button>}
          <button type="button" className="btn sm danger" onClick={() => setConfirm(true)} title="Delete this entity from the project"><Trash2 size={12} /></button>
        </div>
      )}

      <button type="button" className={styles.fold} onClick={() => setLinks(!links)} aria-expanded={links}>
        <ChevronRight size={12} className={styles.chev} data-open={links || undefined} />
        <span>Links</span>
        <span className={styles.foldMeta}>points at {outgoing.length} · pointed at by {incoming.length}</span>
      </button>
      {links && (
        <div className={styles.linkLists}>
          <ul className={styles.links}>
            {outgoing.map((e) => (
              <li key={`${e.path}|${e.target}`} className={styles.link}>
                <span className={styles.port}>{portLabel(e.path, e.key)}</span>
                <button type="button" className={styles.target} data-missing={!e.resolved || undefined} onClick={() => onSelect(e.target)} title={e.path}>{e.target}</button>
                <button type="button" className={styles.icon} title="Disconnect (clears the field)" onClick={() => onDisconnect(e.source, e.path, { target: e.target })}><Unlink size={12} /></button>
              </li>
            ))}
            {!outgoing.length && <li className={styles.empty}>points at nothing</li>}
          </ul>
          <ul className={styles.links}>
            {incoming.map((e) => (
              <li key={`${e.source}|${e.path}`} className={styles.link}>
                <button type="button" className={styles.target} onClick={() => onSelect(e.source)} title={e.path}>{e.source}</button>
                <span className={styles.port}>{portLabel(e.path, e.key)}</span>
              </li>
            ))}
            {!incoming.length && <li className={styles.empty}>nothing in this view points here</li>}
          </ul>
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
