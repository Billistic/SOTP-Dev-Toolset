import { useProject } from '@/hooks/useProject'
import styles from './ProjectSummary.module.css'

/** Sidebar companion for the project view. */
export function ProjectSummary() {
  const { project } = useProject()
  if (!project) return <p className={styles.hint}>No project yet. Fill in the mod root on the right and press Create.</p>
  return (
    <dl className={styles.list}>
      <dt>Name</dt><dd>{project.name}</dd>
      <dt>Mod root</dt><dd className={styles.path}>{project.modRoot}</dd>
      <dt>Base game</dt><dd className={styles.path}>{project.vanillaRoot ?? <span className="muted">not set — inherited assets are reported as notes</span>}</dd>
      <dt>Output</dt><dd className={styles.path}>{project.outputRoot ?? <span className="muted">in place</span>}</dd>
    </dl>
  )
}
