import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { insightsApi } from '@/api/insights'
import { DistributionChart } from '@/components/DistributionChart/DistributionChart'
import { MetricTable } from '@/components/MetricTable/MetricTable'
import { fmtNum } from '@/utils/format'
import styles from './AnalyticsView.module.css'

const CATEGORIES = ['ship', 'module', 'research', 'squad']

/** Two lenses: any numeric field of one entity type (distribution), and typed metric tables per category. */
export function AnalyticsView() {
  const [tab, setTab] = useState<'fields' | 'metrics'>('metrics')
  const [entityType, setEntityType] = useState('Frigate')
  const [path, setPath] = useState('maxSpeedLinear')
  const [groupBy, setGroupBy] = useState<'faction' | 'role'>('faction')
  const [category, setCategory] = useState('ship')

  const { data: types = [] } = useQuery({ queryKey: ['entities', 'types'], queryFn: entitiesApi.types, retry: false })
  const { data: catalog = [] } = useQuery({ queryKey: ['analytics', 'fields', entityType], queryFn: () => insightsApi.fieldCatalog(entityType), enabled: tab === 'fields' })
  const { data: dist } = useQuery({ queryKey: ['analytics', 'dist', entityType, path, groupBy], queryFn: () => insightsApi.distribution(entityType, path, groupBy), enabled: tab === 'fields' && !!path })
  const { data: table } = useQuery({ queryKey: ['analytics', 'metrics', category], queryFn: () => insightsApi.metricTable(category), enabled: tab === 'metrics' })

  const fieldOptions = useMemo(() => catalog.filter((c) => c.numericCount >= 3 && (c.max ?? 0) !== (c.min ?? 0)), [catalog])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button data-active={tab === 'metrics' || undefined} onClick={() => setTab('metrics')}>Metric tables</button>
          <button data-active={tab === 'fields' || undefined} onClick={() => setTab('fields')}>Field distributions</button>
        </div>
        {tab === 'fields' ? (
          <>
            <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPath('') }}>
              {types.map((t) => <option key={t.entityType} value={t.entityType}>{t.entityType} ({t.count})</option>)}
            </select>
            <select value={path} onChange={(e) => setPath(e.target.value)} className={styles.pathSelect}>
              <option value="">choose a numeric field…</option>
              {fieldOptions.map((c) => <option key={c.path} value={c.path}>{c.path} ({c.numericCount})</option>)}
            </select>
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as 'faction' | 'role')}>
              <option value="faction">by faction</option><option value="role">by role</option>
            </select>
          </>
        ) : (
          <>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
            <a className="btn sm" href={insightsApi.csvUrl(category === 'ship' ? 'Frigate' : category === 'module' ? 'PlanetModuleStandard' : category === 'research' ? 'ResearchSubject' : 'Squad')} download>
              <Download size={12} /> CSV
            </a>
          </>
        )}
      </div>

      <div className={styles.body}>
        {tab === 'fields' && dist && (
          <>
            <div className={styles.summaryRow}>
              {Object.entries(dist.groups).map(([g, s]) => (
                <div key={g} className={styles.stat}>
                  <strong>{g}</strong>
                  <span>n={s.count} · median {fmtNum(s.median)} · mean {fmtNum(s.mean)}</span>
                  <span className="muted">{fmtNum(s.min)} – {fmtNum(s.max)}</span>
                </div>
              ))}
            </div>
            <DistributionChart data={dist} />
          </>
        )}
        {tab === 'fields' && !dist && <p className={styles.hint}>Pick an entity type and a numeric field.</p>}
        {tab === 'metrics' && table && <MetricTable table={table} />}
      </div>
    </div>
  )
}
