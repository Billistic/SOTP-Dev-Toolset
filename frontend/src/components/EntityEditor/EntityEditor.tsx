import { useState } from 'react'
import { Copy, Save, Trash2, Undo2, Users } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { entitiesApi } from '@/api/entities'
import { useEntity } from '@/hooks/useEntity'
import { useUiStore, type EditorMode } from '@/store/useUiStore'
import { factionColor } from '@/utils/format'
import { FormView } from '@/components/FormView/FormView'
import { TreeEditor } from '@/components/TreeEditor/TreeEditor'
import { WeaponEditor } from '@/components/WeaponEditor/WeaponEditor'
import { findNode } from '@/utils/tree'
import { RawEditor } from '@/components/RawEditor/RawEditor'
import { ReferencesPanel } from '@/components/ReferencesPanel/ReferencesPanel'
import { PeerPanel } from '@/components/PeerPanel/PeerPanel'
import { EmptyState } from '@/components/EmptyState/EmptyState'
import { NewEntityDialog } from '@/components/NewEntityDialog/NewEntityDialog'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import styles from './EntityEditor.module.css'

const MODES: { id: EditorMode; label: string }[] = [
  { id: 'form', label: 'Form' }, { id: 'tree', label: 'Tree' }, { id: 'weapons', label: 'Weapons' },
  { id: 'raw', label: 'Raw' }, { id: 'references', label: 'References' }, { id: 'peers', label: 'Peers' },
]

export function EntityEditor({ name }: { name: string }) {
  const { entity, isLoading, error, edit, revert, write, remove } = useEntity(name)
  const mode = useUiStore((s) => s.editorMode)
  const setMode = useUiStore((s) => s.setEditorMode)
  const [dialog, setDialog] = useState<null | 'duplicate' | 'delete'>(null)
  const { data: players } = useQuery({ queryKey: ['entity', name, 'players'], queryFn: () => entitiesApi.players(name) })

  if (isLoading) return <EmptyState title="Loading…" />
  if (error || !entity) return <EmptyState title="Entity not found" detail={error?.message} />

  const hasWeapons = entity.weapons.length > 0 || !!findNode(entity.tree.root, 'NumWeapons')   // weaponless ships can still gain weapons
  const playerList = [...new Set((players ?? []).map((p) => p.player.replace(/^Player_/, '')))]

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.swatch} style={{ background: factionColor(entity.race) }} />
          <h2 className={styles.name}>{entity.name}</h2>
          <span className={styles.type}>{entity.entityType}</span>
          {entity.faction && <span className={styles.chip}>{entity.race} · {entity.faction}</span>}
          {entity.role && <span className={styles.chip}>{entity.role}</span>}
          {entity.isDirty && <span className={styles.dirty}>unsaved</span>}
          {entity.sourceMissing && <span className={styles.missing}>not on disk</span>}
        </div>
        <div className={styles.meta}>
          {entity.displayName && <span className={styles.display}>“{entity.displayName}”</span>}
          <span className="muted">{entity.sourcePath} · {entity.fmt}{entity.archiveVersion ? ` v${entity.archiveVersion}` : ''} · {entity.lineCount} lines</span>
          {playerList.length > 0 && <span className={styles.players} title="Players that can build/research this"><Users size={12} /> {playerList.join(', ')}</span>}
        </div>
        <div className={styles.actions}>
          <button className="btn sm" onClick={() => setDialog('duplicate')} title="Create a new entity as a copy of this one"><Copy size={13} /> Duplicate</button>
          <button className="btn sm" onClick={() => setDialog('delete')} title="Remove this entity from the project"><Trash2 size={13} /></button>
          <span className={styles.sep} />
          <button className="btn sm" onClick={() => revert.mutate()} disabled={!entity.isDirty || revert.isPending} title="Discard edits and reload from disk"><Undo2 size={13} /> Revert</button>
          <button className="btn sm primary" onClick={() => write.mutate('preserve')} disabled={write.isPending} title="Write this entity to disk"><Save size={13} /> Write</button>
        </div>
      </header>
      {dialog === 'duplicate' && <NewEntityDialog initialType={entity.entityType} initialTemplate={entity.name} onClose={() => setDialog(null)} />}
      {dialog === 'delete' && (
        <ConfirmDialog title="Delete entity" confirmLabel="Delete" danger busy={remove.isPending} onCancel={() => setDialog(null)}
                       onConfirm={() => remove.mutate(undefined, { onSettled: () => setDialog(null) })}>
          <p>Remove <code>{entity.name}</code> from the project?</p>
          {entity.sourceMissing
            ? <p className="muted">It has never been written, so nothing on disk changes.</p>
            : <p className="muted">Its file is moved to <code>.sotp-trash/</code> inside the mod folder, not destroyed. Write the manifest afterwards so the game stops looking for it.</p>}
          <p className="muted">Entities that reference it will get missing-link diagnostics.</p>
        </ConfirmDialog>
      )}

      <nav className={styles.modes} role="tablist">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} className={styles.mode} data-active={mode === m.id || undefined}
                  disabled={m.id === 'weapons' && !hasWeapons} onClick={() => setMode(m.id)}>
            {m.label}{m.id === 'weapons' && hasWeapons ? ` (${entity.weapons.length})` : ''}
          </button>
        ))}
      </nav>

      <div className={styles.body}>
        {mode === 'form' && <FormView entity={entity} onEdit={(c) => edit.mutate(c)} busy={edit.isPending} />}
        {mode === 'tree' && <TreeEditor entity={entity} onEdit={(c) => edit.mutate(c)} busy={edit.isPending} />}
        {mode === 'weapons' && <WeaponEditor entity={entity} onEdit={(c) => edit.mutate(c)} busy={edit.isPending} />}
        {mode === 'raw' && <RawEditor name={entity.name} diagnostics={entity.diagnostics} />}
        {mode === 'references' && <ReferencesPanel name={entity.name} />}
        {mode === 'peers' && <PeerPanel name={entity.name} />}
      </div>
    </div>
  )
}
