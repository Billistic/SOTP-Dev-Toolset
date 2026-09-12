import { useProject } from '@/hooks/useProject'
import { useUiStore } from '@/store/useUiStore'
import styles from './WelcomeView.module.css'

export function WelcomeView() {
  const { project, missing, ingest } = useProject()
  const setActivity = useUiStore((s) => s.setActivity)
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>SOTP Dev Env <span className={styles.v}>v2</span></h1>
      <p className={styles.tag}>Entity, research, string and asset management for Sins of the Prophets — with link checking and balance analytics before anything hits the game.</p>
      {missing && (
        <div className={styles.step}>
          <strong>1. Point at the mod</strong>
          <p>Create a project with the mod root (the folder holding <code>GameInfo/</code> and <code>entity.manifest</code>).</p>
          <button className="btn primary" onClick={() => setActivity('project')}>Open project settings</button>
        </div>
      )}
      {project && (
        <div className={styles.steps}>
          <div className={styles.step}><strong>Ingest</strong><p>Scan the mod folder; unchanged files are skipped.</p><button className="btn" onClick={() => ingest.mutate({ id: project.id })} disabled={ingest.isPending}>{ingest.isPending ? 'Ingesting…' : 'Ingest now'}</button></div>
          <div className={styles.step}><strong>Browse</strong><p>Open an entity from the tree on the left to edit it as a form, tree or raw text.</p></div>
          <div className={styles.step}><strong>Fix</strong><p>Diagnostics list missing links, manifest drift and research slot collisions.</p><button className="btn" onClick={() => setActivity('diagnostics')}>Diagnostics</button></div>
          <div className={styles.step}><strong>Balance</strong><p>Compare units against their peers and get concrete tuning levers.</p><button className="btn" onClick={() => setActivity('balance')}>Balance</button></div>
        </div>
      )}
      <p className={styles.keys}><kbd>Ctrl</kbd>+<kbd>B</kbd> sidebar · <kbd>Ctrl</kbd>+<kbd>`</kbd> problems panel · middle-click closes a tab</p>
    </div>
  )
}
