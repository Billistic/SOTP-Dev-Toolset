import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, CircleAlert, ExternalLink } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useUiStore } from '@/store/useUiStore'
import type { Reference } from '@/types/api'
import styles from './ReferencesPanel.module.css'

const KIND_ORDER = ['entity', 'string', 'mesh', 'particle', 'explosion', 'sound', 'music', 'brush', 'texture', 'texanim']

/** Outgoing references grouped by kind (with resolution state) and incoming references from other entities. */
export function ReferencesPanel({ name }: { name: string }) {
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)
  const openEntity = useUiStore((s) => s.openEntity)
  const { data: out = [] } = useQuery({ queryKey: ['entity', name, 'references'], queryFn: () => entitiesApi.references(name) })
  const { data: incoming = [] } = useQuery({ queryKey: ['entity', name, 'referenced-by'], queryFn: () => entitiesApi.referencedBy(name) })

  const groups = useMemo(() => {
    const m = new Map<string, Reference[]>()
    for (const r of out) if (!unresolvedOnly || !r.resolved) m.set(r.kind, [...(m.get(r.kind) ?? []), r])
    return [...m.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))
  }, [out, unresolvedOnly])
  const unresolved = out.filter((r) => !r.resolved).length

  return (
    <div className={styles.root}>
      <section className={styles.col}>
        <header className={styles.head}>
          <ArrowUpRight size={14} /> Outgoing <span className="muted">{out.length}</span>
          {unresolved > 0 && <span className={styles.badge}>{unresolved} unresolved</span>}
          <label className={styles.filter}><input type="checkbox" checked={unresolvedOnly} onChange={(e) => setUnresolvedOnly(e.target.checked)} /> unresolved only</label>
        </header>
        {groups.map(([kind, refs]) => (
          <div key={kind} className={styles.group}>
            <h4 className={styles.kind}>{kind} <span className="muted">{refs.length}</span></h4>
            <ul>
              {refs.map((r, i) => (
                <li key={`${r.path}-${i}`} className={styles.ref} data-unresolved={!r.resolved || undefined}>
                  {r.resolved ? <CheckCircle2 size={13} className={styles.ok} /> : <CircleAlert size={13} className={styles.bad} />}
                  <span className={styles.target} title={r.path}>{r.target}</span>
                  <span className={styles.path}>{r.path}</span>
                  {r.resolvedSource === 'vanilla' && <span className={styles.vanilla}>vanilla</span>}
                  {r.kind === 'entity' && r.resolved && <button className={styles.open} onClick={() => openEntity(r.target)} title="Open"><ExternalLink size={12} /></button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!out.length && <p className={styles.hint}>No references.</p>}
      </section>
      <section className={styles.col}>
        <header className={styles.head}><ArrowDownLeft size={14} /> Referenced by <span className="muted">{incoming.length}</span></header>
        <ul>
          {incoming.map((r, i) => (
            <li key={`${r.source.name}-${r.path}-${i}`} className={styles.ref}>
              <button className={styles.srcName} onClick={() => openEntity(r.source.name)}>{r.source.name}</button>
              <span className={styles.srcType}>{r.source.entityType}</span>
              <span className={styles.path}>{r.path}</span>
            </li>
          ))}
        </ul>
        {!incoming.length && <p className={styles.hint}>Nothing references this entity. If it should be buildable, check the Player lists.</p>}
      </section>
    </div>
  )
}
