import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { useDebounce } from '@/hooks/useDebounce'
import styles from './AssetsView.module.css'

const KIND_LABEL: Record<string, string> = {
  mesh: 'Meshes', particle: 'Particles', texture: 'Textures', sound: 'Sound effects', music: 'Music',
  brush: 'Brushes (UI)', explosion: 'Explosions', texanim: 'Texture animations', fx: 'Shaders', ogg: 'Audio files',
  entity: 'Vanilla entities', string: 'Vanilla strings',
}

/** Asset index browser: counts per kind and a searchable list with parsed metadata. */
export function AssetsView() {
  const [kind, setKind] = useState('mesh')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search)
  const { data: kinds = [] } = useQuery({ queryKey: ['assets', 'kinds'], queryFn: catalogApi.assetKinds, retry: false })
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['assets', kind, debounced],
    queryFn: () => catalogApi.assets({ kind, search: debounced || undefined, limit: 1000 }),
    retry: false,
  })
  const totals = kinds.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k.kind]: (acc[k.kind] ?? 0) + k.count }), {})

  return (
    <div className={styles.root}>
      <aside className={styles.kinds}>
        {Object.entries(totals).sort().map(([k, n]) => (
          <button key={k} className={styles.kind} data-active={kind === k || undefined} onClick={() => setKind(k)}>
            <span>{KIND_LABEL[k] ?? k}</span><span className={styles.n}>{n}</span>
          </button>
        ))}
      </aside>
      <section className={styles.main}>
        <div className={styles.toolbar}>
          <div className={styles.search}><Search size={14} /><input type="search" placeholder={`Search ${KIND_LABEL[kind] ?? kind}…`} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          <span className="muted">{rows.length} shown</span>
        </div>
        <div className={styles.list}>
          {isLoading ? <p className={styles.hint}>Loading…</p> : (
            <table className={styles.table}>
              <thead><tr><th>Name</th><th>Source</th><th>Path</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td className={styles.name}>{a.name}</td>
                    <td><span className={styles.src} data-src={a.source}>{a.source}</span></td>
                    <td className={styles.path}>{a.path}</td>
                    <td className={styles.meta}>{describeMeta(a.meta, a.sizeBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}

function describeMeta(meta: Record<string, unknown>, size: number | null): string {
  const parts: string[] = []
  if (size) parts.push(size > 1e6 ? `${(size / 1e6).toFixed(1)} MB` : `${Math.round(size / 1024)} KB`)
  if (meta.binary !== undefined) parts.push(meta.binary ? 'binary' : 'text')
  if (meta.boundingRadius) parts.push(`r=${Number(meta.boundingRadius).toFixed(0)}`)
  if (meta.emitters !== undefined) parts.push(`${meta.emitters} emitters`)
  if (Array.isArray(meta.textures) && meta.textures.length) parts.push(`tex: ${(meta.textures as string[]).slice(0, 3).join(', ')}${meta.textures.length > 3 ? '…' : ''}`)
  if (Array.isArray(meta.pipelineEffects) && meta.pipelineEffects.length) parts.push(`fx: ${(meta.pipelineEffects as string[]).join(', ')}`)
  if (meta.file) parts.push(String(meta.file))
  if (meta.type) parts.push(String(meta.type))
  if (meta.content) parts.push(String(meta.content))
  if (meta.definedIn) parts.push(`in ${meta.definedIn}`)
  return parts.join(' · ')
}
