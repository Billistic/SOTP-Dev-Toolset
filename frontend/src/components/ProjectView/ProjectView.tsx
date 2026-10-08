import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FolderOpen, ListChecks, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { projectsApi } from '@/api/projects'
import { insightsApi } from '@/api/insights'
import { useProject } from '@/hooks/useProject'
import { toast } from '@/store/useToastStore'
import { DirectoryPicker } from '@/components/DirectoryPicker/DirectoryPicker'
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog'
import { useUiStore } from '@/store/useUiStore'
import type { Project } from '@/types/api'
import { UpdatesCard } from '@/components/UpdatesCard/UpdatesCard'
import { factionColor } from '@/utils/format'
import styles from './ProjectView.module.css'

type PickTarget = 'modRoot' | 'vanillaRoot' | 'outputRoot' | null

/** Project settings, ingest controls and a headline overview of the mod. */
export function ProjectView() {
  const { project, ingest, validate } = useProject()
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', modRoot: '', vanillaRoot: '', outputRoot: '' })
  const [picking, setPicking] = useState<PickTarget>(null)
  const [creating, setCreating] = useState(false)
  const [newRoot, setNewRoot] = useState(false)          // Save with a different mod root: new project or re-point?
  const [removing, setRemoving] = useState<Project | null>(null)
  const closeEntityTabs = useUiStore((s) => s.closeEntityTabs)
  const resetForm = (p: Project | null) =>
    setForm(p ? { name: p.name, modRoot: p.modRoot, vanillaRoot: p.vanillaRoot ?? '', outputRoot: p.outputRoot ?? '' } : { name: '', modRoot: '', vanillaRoot: '', outputRoot: '' })
  useEffect(() => { if (!creating) resetForm(project) }, [project]) // eslint-disable-line react-hooks/exhaustive-deps

  // every project has its own database file; switching re-points the whole UI at it
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: projectsApi.list })
  const switched = (p: Project, verb: string) => { closeEntityTabs(); qc.invalidateQueries(); toast.success(`${verb} ${p.name}`) }
  const switchTo = useMutation({
    mutationFn: (id: number) => projectsApi.activate(id),
    onSuccess: (p) => switched(p, 'Switched to'),
    onError: (e: Error) => toast.error(e.message),
  })
  const createNew = useMutation({
    mutationFn: async () => {
      const name = form.name.trim() && form.name !== project?.name ? form.name.trim() : form.modRoot.split(/[\\/]/).filter(Boolean).pop() || 'Project'
      const p = await projectsApi.create({ ...form, name })
      await projectsApi.activate(p.id)
      const stats = await projectsApi.ingest(p.id)
      return { p, stats }
    },
    onSuccess: ({ p, stats }) => { setCreating(false); setNewRoot(false); switched(p, `Created (${stats.added} entities) and switched to`) },
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: (p: Project) => projectsApi.remove(p.id).then(() => p),
    onSuccess: (p) => { setRemoving(null); closeEntityTabs(); qc.invalidateQueries(); toast.success(`Removed ${p.name} and its database`) },
    onError: (e: Error) => toast.error(e.message),
  })

  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: insightsApi.overview, enabled: !!project, retry: false })
  const save = useMutation({
    mutationFn: () => projectsApi.update(project!.id, form),
    onSuccess: () => { setNewRoot(false); toast.success('Project saved'); qc.invalidateQueries({ queryKey: ['project'] }); qc.invalidateQueries({ queryKey: ['projects'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const writeDirty = useMutation({
    mutationFn: () => insightsApi.writeDirty(),
    onSuccess: (r) => { toast.success(`Wrote ${r.written.length} file(s)`); qc.invalidateQueries() },
    onError: (e: Error) => toast.error(e.message),
  })
  const { data: manifest } = useQuery({ queryKey: ['manifest'], queryFn: insightsApi.manifestStatus, enabled: !!project, retry: false })
  const writeManifest = useMutation({
    mutationFn: () => insightsApi.writeManifest(),
    onSuccess: (r) => {
      const n = r.added.length + r.removed.length
      toast[n ? 'success' : 'info'](n ? `entity.manifest: +${r.added.length} / -${r.removed.length} (${r.count} entries)` : 'entity.manifest already in step')
      qc.invalidateQueries({ queryKey: ['diagnostics'] }); qc.invalidateQueries({ queryKey: ['manifest'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const field = (key: keyof typeof form, label: string, hint: string, pick = true) => (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.inputRow}>
        <input value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} spellCheck={false} />
        {pick && <button className="btn sm" onClick={() => setPicking(key as PickTarget)} title="Browse"><FolderOpen size={13} /></button>}
      </div>
      <span className={styles.hint}>{hint}</span>
    </label>
  )

  return (
    <div className={styles.root}>
      {projects.length > 0 && (
        <section className={styles.card}>
          <h3 className={styles.title}>Projects</h3>
          <p className={styles.hint}>Each project keeps its own database, so switching never mixes one mod's data into another's.</p>
          <ul className={styles.projects}>
            {projects.map((p) => (
              <li key={p.id} data-active={p.isActive || undefined}>
                <div className={styles.projectText}>
                  <strong>{p.name}</strong>
                  <span className={styles.mono} title={p.modRoot}>{p.modRoot}</span>
                  <span className={styles.hint}>{p.lastIngestAt ? `ingested ${new Date(p.lastIngestAt).toLocaleString()}` : 'not ingested yet'}</span>
                </div>
                {p.isActive ? <span className={styles.activeTag}><Check size={12} /> active</span>
                  : <button className="btn sm" onClick={() => switchTo.mutate(p.id)} disabled={switchTo.isPending}>Switch</button>}
                <button className="btn sm" onClick={() => setRemoving(p)} title="Remove project and delete its database (the mod folder is not touched)"><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button className="btn" onClick={() => { setCreating(true); resetForm(null) }} disabled={creating}><Plus size={14} /> New project</button>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <h3 className={styles.title}>{creating || !project ? 'New project' : 'Project settings'}</h3>
        {field('name', 'Name', 'Shown in the status bar.', false)}
        {field('modRoot', 'Mod root', 'Folder containing GameInfo/, entity.manifest, Mesh/, Particle/, String/…')}
        {field('vanillaRoot', 'Base game root (optional)', 'Sins of a Solar Empire: Rebellion install. Lets reference checks fall back to inherited vanilla assets, entities and strings so only real breakage is flagged.')}
        {field('outputRoot', 'Output root (optional)', 'Write edited files here instead of in place. Leave empty to write into the mod root.')}
        <div className={styles.actions}>
          {creating || !project ? (
            <>
              <button className="btn primary" onClick={() => createNew.mutate()} disabled={createNew.isPending || !form.modRoot}>
                <Plus size={14} /> {createNew.isPending ? 'Creating and ingesting…' : 'Create and ingest'}</button>
              {creating && project && <button className="btn" onClick={() => { setCreating(false); resetForm(project) }} disabled={createNew.isPending}><X size={14} /> Cancel</button>}
            </>
          ) : (
            <button className="btn primary" onClick={() => (form.modRoot !== project.modRoot ? setNewRoot(true) : save.mutate())} disabled={save.isPending || !form.modRoot}><Save size={14} /> Save</button>
          )}
          {project && !creating && (
            <>
              <button className="btn" onClick={() => ingest.mutate({ id: project.id })} disabled={ingest.isPending}><RefreshCw size={14} className={ingest.isPending ? styles.spin : undefined} /> Ingest changes</button>
              <button className="btn" onClick={() => ingest.mutate({ id: project.id, force: true })} disabled={ingest.isPending} title="Re-parse every file, discarding unsaved edits">Force full re-ingest</button>
              <button className="btn" onClick={() => validate.mutate(project.id)} disabled={validate.isPending}>Re-validate</button>
            </>
          )}
        </div>
        {project?.lastIngestAt && <p className={styles.hint}>Last ingest: {new Date(project.lastIngestAt).toLocaleString()}</p>}
      </section>

      {project && (
        <section className={styles.card}>
          <h3 className={styles.title}>Write back to disk</h3>
          <p className={styles.hint}>Edits are kept in the database until written. Writing preserves the original bytes of every untouched line.</p>
          <div className={styles.actions}>
            <button className="btn" onClick={() => writeDirty.mutate()} disabled={writeDirty.isPending}><Download size={14} /> Write all unsaved entities</button>
          </div>
        </section>
      )}

      {project && (
        <section className={styles.card}>
          <h3 className={styles.title}>entity.manifest</h3>
          <p className={styles.hint}>
            The game's load list. It is kept in step automatically: a new entity's first write adds its line, deleting an entity removes it.
            Sync adds any tool-written file that is still missing{manifest?.vanillaIndexed ? ' and drops entries with no file in the mod or the base game' : ''}; hand-made entries are never touched.
          </p>
          {manifest && (
            <div className={styles.stats}>
              <div><strong>{manifest.count}</strong><span>listed</span></div>
              <div><strong style={{ color: manifest.unlistedWritten.length ? 'var(--warning)' : undefined }}>{manifest.unlistedWritten.length}</strong><span>written, not listed</span></div>
              <div><strong>{manifest.unlisted.length}</strong><span>on disk, not listed</span></div>
              <div><strong style={{ color: manifest.missing.length && manifest.vanillaIndexed ? 'var(--error)' : undefined }}>{manifest.missing.length}</strong><span>{manifest.vanillaIndexed ? 'listed, no file' : 'listed, not in mod'}</span></div>
            </div>
          )}
          <div className={styles.actions}>
            <button className="btn" onClick={() => writeManifest.mutate()} disabled={writeManifest.isPending}><ListChecks size={14} /> Sync entity.manifest</button>
          </div>
        </section>
      )}

      {overview && (
        <section className={styles.card}>
          <h3 className={styles.title}>Overview</h3>
          <div className={styles.stats}>
            <div><strong>{overview.types.reduce((n, t) => n + t.count, 0)}</strong><span>entities</span></div>
            <div><strong>{overview.strings}</strong><span>strings</span></div>
            <div><strong style={{ color: 'var(--error)' }}>{overview.diagnostics.error ?? 0}</strong><span>errors</span></div>
            <div><strong style={{ color: 'var(--warning)' }}>{overview.diagnostics.warning ?? 0}</strong><span>warnings</span></div>
          </div>
          <div className={styles.grid}>
            <div>
              <h4 className={styles.sub}>By type</h4>
              <ul className={styles.rows}>{overview.types.map((t) => <li key={t.entityType}><span>{t.entityType}</span><span className="muted">{t.count}{t.errors ? ` · ${t.errors} err` : ''}</span></li>)}</ul>
            </div>
            <div>
              <h4 className={styles.sub}>By faction</h4>
              <ul className={styles.rows}>{overview.factions.map((f) => <li key={`${f.race}-${f.faction}`}><span><i className={styles.swatch} style={{ background: factionColor(f.race) }} />{f.race ?? '—'} · {f.faction ?? 'shared'}</span><span className="muted">{f.count}</span></li>)}</ul>
            </div>
          </div>
        </section>
      )}

      <UpdatesCard />

      {newRoot && project && (
        <ConfirmDialog title="Different mod folder" confirmLabel="Create new project" busy={createNew.isPending || save.isPending}
                       onConfirm={() => createNew.mutate()} onCancel={() => setNewRoot(false)}>
          <p>You picked a different mod root than <strong>{project.name}</strong> uses.</p>
          <p>A <strong>new project</strong> gets its own database and leaves {project.name} as it is; you can switch back at any time.</p>
          <p className={styles.hint}>Only if this is the same mod in a new location (moved folder):{' '}
            <button type="button" className={styles.linkBtn} onClick={() => save.mutate()}>re-point {project.name} instead</button></p>
        </ConfirmDialog>
      )}
      {removing && (
        <ConfirmDialog title={`Remove ${removing.name}?`} confirmLabel="Remove project" danger busy={remove.isPending}
                       onConfirm={() => remove.mutate(removing)} onCancel={() => setRemoving(null)}>
          <p>Deletes this project's database: indexed data, diagnostics, graph layouts and any <strong>unsaved edits</strong>.</p>
          <p className={styles.hint}>The mod folder on disk ({removing.modRoot}) is not touched.</p>
        </ConfirmDialog>
      )}
      {picking && (
        <DirectoryPicker initial={form[picking] || form.modRoot} onCancel={() => setPicking(null)}
                         onPick={(p) => { setForm({ ...form, [picking]: p }); setPicking(null) }} />
      )}
    </div>
  )
}
