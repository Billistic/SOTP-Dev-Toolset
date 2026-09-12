import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FolderOpen, RefreshCw, Save } from 'lucide-react'
import { projectsApi } from '@/api/projects'
import { insightsApi } from '@/api/insights'
import { useProject } from '@/hooks/useProject'
import { toast } from '@/store/useToastStore'
import { DirectoryPicker } from '@/components/DirectoryPicker/DirectoryPicker'
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
  useEffect(() => {
    if (project) setForm({ name: project.name, modRoot: project.modRoot, vanillaRoot: project.vanillaRoot ?? '', outputRoot: project.outputRoot ?? '' })
  }, [project])

  const { data: overview } = useQuery({ queryKey: ['overview'], queryFn: insightsApi.overview, enabled: !!project, retry: false })
  const save = useMutation({
    mutationFn: () => (project ? projectsApi.update(project.id, form) : projectsApi.create(form)),
    onSuccess: () => { toast.success('Project saved'); qc.invalidateQueries({ queryKey: ['project'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const writeDirty = useMutation({
    mutationFn: () => insightsApi.writeDirty(),
    onSuccess: (r) => { toast.success(`Wrote ${r.written.length} file(s)`); qc.invalidateQueries() },
    onError: (e: Error) => toast.error(e.message),
  })
  const writeManifest = useMutation({
    mutationFn: () => insightsApi.writeManifest(),
    onSuccess: (r) => { toast.success(`Wrote ${r.written}`); qc.invalidateQueries({ queryKey: ['diagnostics'] }) },
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
      <section className={styles.card}>
        <h3 className={styles.title}>{project ? 'Project settings' : 'Create a project'}</h3>
        {field('name', 'Name', 'Shown in the status bar.', false)}
        {field('modRoot', 'Mod root', 'Folder containing GameInfo/, entity.manifest, Mesh/, Particle/, String/…')}
        {field('vanillaRoot', 'Base game root (optional)', 'Sins of a Solar Empire: Rebellion install. Lets reference checks fall back to inherited vanilla assets, entities and strings so only real breakage is flagged.')}
        {field('outputRoot', 'Output root (optional)', 'Write edited files here instead of in place. Leave empty to write into the mod root.')}
        <div className={styles.actions}>
          <button className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || !form.modRoot}><Save size={14} /> {project ? 'Save' : 'Create'}</button>
          {project && (
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
            <button className="btn" onClick={() => { if (window.confirm('Regenerate entity.manifest from every entity in the database?')) writeManifest.mutate() }}>Regenerate entity.manifest</button>
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

      {picking && (
        <DirectoryPicker initial={form[picking] || form.modRoot} onCancel={() => setPicking(null)}
                         onPick={(p) => { setForm({ ...form, [picking]: p }); setPicking(null) }} />
      )}
    </div>
  )
}
