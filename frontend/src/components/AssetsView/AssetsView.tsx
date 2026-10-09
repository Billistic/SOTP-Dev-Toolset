import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { catalogApi } from '@/api/catalog'
import { useDebounce } from '@/hooks/useDebounce'
import styles from './AssetsView.module.css'

const PAGE = 1000
const KIND_LABEL: Record<string, string> = {
  mesh: 'Meshes', particle: 'Particles', texture: 'Textures', sound: 'Sound effects', music: 'Music',
  brush: 'Brushes (UI)', explosion: 'Explosions', texanim: 'Texture animations', fx: 'Shaders', ogg: 'Audio files',
  entity: 'Vanilla entities', string: 'Vanilla strings',
}

type Source = '' | 'mod' | 'vanilla'

/** Asset index browser: counts per kind, mod / base-game toggle, folder filter and a searchable list with parsed metadata. */
export function AssetsView() {
  const [kind, setKind] = useState('mesh')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState<Source>('')
  const [limit, setLimit] = useState(PAGE)
  const [dir, setDir] = useState<string | null>(null)   // null = all folders, '' = files with no folder
  const debounced = useDebounce(search)
  const { data: kinds = [] } = useQuery({ queryKey: ['assets', 'kinds'], queryFn: catalogApi.assetKinds, retry: false })
  const hasVanilla = kinds.some((k) => k.source === 'vanilla')   // a base-game root is indexed: the toggle makes sense
  // totals and folders come from the server over every match; the list itself is capped (mod assets listed first)
  const filters = { kind, search: debounced || undefined, source: source || undefined }
  const { data: summary } = useQuery({ queryKey: ['assets', 'summary', kind, debounced, source], queryFn: () => catalogApi.assetSummary(filters), retry: false })
  const { data: shown = [], isLoading } = useQuery({
    queryKey: ['assets', kind, debounced, source, dir, limit],
    queryFn: () => catalogApi.assets({ ...filters, folder: dir === null ? undefined : dir || '.', limit }),
    placeholderData: (prev) => prev,   // keep the rows on screen while the next page loads
    retry: false,
  })
  const totals = kinds.reduce<Record<string, number>>((acc, k) => ({ ...acc, [k.kind]: (acc[k.kind] ?? 0) + k.count }), {})
  useEffect(() => { setDir(null); setLimit(PAGE) }, [kind, source, debounced])
  useEffect(() => setLimit(PAGE), [dir])   // a folder picked for one kind means nothing for the next
  const matching = dir === null ? summary?.total : summary?.folders.find((f) => f.folder === dir)?.count
  const capped = matching !== undefined && shown.length < matching

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
          <div className={styles.search}><Search size={14} /><input type="search" data-bare placeholder={`Search ${KIND_LABEL[kind] ?? kind}…`} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {hasVanilla && (
            <div className={styles.seg} role="group" aria-label="Source">
              {([['', 'all'], ['mod', 'mod'], ['vanilla', 'base game']] as [Source, string][]).map(([v, l]) => (
                <button key={v} type="button" data-active={source === v || undefined} onClick={() => { setSource(v); setDir(null) }}>{l}</button>
              ))}
            </div>
          )}
          <select value={dir ?? '*'} onChange={(e) => setDir(e.target.value === '*' ? null : e.target.value)} title="Only assets in this folder" className={styles.dirSel}>
            <option value="*">all folders</option>
            {(summary?.folders ?? []).map((f) => <option key={f.folder} value={f.folder}>{f.folder || '(no folder)'} ({f.count})</option>)}
          </select>
          <span className="muted">
            {shown.length}{matching !== undefined && matching !== shown.length ? ` of ${matching}` : ''} shown
            {source === '' && summary?.bySource.vanilla ? ` \u00b7 ${summary.bySource.mod ?? 0} mod, ${summary.bySource.vanilla} base game` : ''}
          </span>
          {capped && (
            <span className={styles.capped}>First {shown.length} listed (mod assets first)
              {' '}<button type="button" className="btn sm" onClick={() => setLimit((n) => Math.min(5000, n + PAGE))} disabled={limit >= 5000}>Show {Math.min(PAGE, (matching ?? 0) - shown.length)} more</button>
            </span>
          )}
        </div>
        <div className={styles.list}>
          {isLoading ? <p className={styles.hint}>Loading…</p> : (
            <table className={styles.table}>
              <thead><tr><th>Name</th><th>Source</th><th>Path</th><th>Details</th></tr></thead>
              <tbody>
                {shown.map((a) => (
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
