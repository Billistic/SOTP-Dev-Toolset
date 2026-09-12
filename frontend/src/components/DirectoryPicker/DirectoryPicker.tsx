import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Check, Folder, FolderOpen } from 'lucide-react'
import { projectsApi } from '@/api/projects'
import styles from './DirectoryPicker.module.css'

interface Props {
  initial?: string
  onPick: (path: string) => void
  onCancel: () => void
}

/** Minimal server-side folder browser (the browser sandbox cannot read local paths). */
export function DirectoryPicker({ initial = '', onPick, onCancel }: Props) {
  const [path, setPath] = useState(initial)
  const { data, isLoading, error } = useQuery({ queryKey: ['browse', path], queryFn: () => projectsApi.browse(path), retry: false })

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Choose folder">
        <header className={styles.head}>
          <button className="btn sm" disabled={!data?.parent && data?.parent !== ''} onClick={() => data && setPath(data.parent ?? '')}><ArrowUp size={13} /></button>
          <input className={styles.pathInput} value={path} onChange={(e) => setPath(e.target.value)} placeholder="Drive or folder path" spellCheck={false} />
        </header>
        <ul className={styles.list}>
          {isLoading && <li className={styles.hint}>Loading…</li>}
          {error && <li className={styles.hint}>{(error as Error).message}</li>}
          {data?.dirs.map((d) => (
            <li key={d}>
              <button className={styles.dir} onDoubleClick={() => setPath(d)} onClick={() => setPath(d)}>
                <Folder size={14} /> {d.replace(/\/$/, '').split('/').pop() || d}
              </button>
            </li>
          ))}
        </ul>
        <footer className={styles.foot}>
          {data?.isModRoot ? <span className={styles.ok}><Check size={13} /> Looks like a mod root (GameInfo + entity.manifest)</span> : <span className="muted">Double-click to enter a folder</span>}
          <span className={styles.spacer} />
          <button className="btn sm" onClick={onCancel}>Cancel</button>
          <button className="btn sm primary" disabled={!path} onClick={() => onPick(path)}><FolderOpen size={13} /> Use this folder</button>
        </footer>
      </div>
    </div>
  )
}
