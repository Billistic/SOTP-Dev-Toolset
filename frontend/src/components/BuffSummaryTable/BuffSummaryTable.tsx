import { Fragment, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { useUiStore } from '@/store/useUiStore'
import { factionColor, fmtNum, fmtPct, humanKey } from '@/utils/format'
import type { BuffSummary } from '@/types/api'
import styles from './BuffSummaryTable.module.css'

const RACE_OF: Record<string, string> = { Cole: 'UNSC', Hood: 'UNSC', Stanforth: 'UNSC', Regret: 'Covenant', Thel: 'Covenant' }

/** Fleet-wide "abilities on" lens: base vs buffed headline metrics for every unit whose own buffs change them. */
export function BuffSummaryTable({ data }: { data: BuffSummary }) {
  const openEntity = useUiStore((s) => s.openEntity)
  const setMode = useUiStore((s) => s.setEditorMode)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: 'dps_total_pct', dir: 1 })
  const [faction, setFaction] = useState('')
  const [filter, setFilter] = useState('')
  const [changedOnly, setChangedOnly] = useState(true)

  const factions = useMemo(() => [...new Set(data.rows.map((r) => String(r.faction ?? '')))].filter(Boolean).sort(), [data])
  const rows = useMemo(() => {
    const f = filter.toLowerCase()
    const out = data.rows.filter((r) => (!faction || r.faction === faction) && (!f || String(r.name).toLowerCase().includes(f))
      && (!changedOnly || data.headline.some((h) => (r[`${h}_pct`] as number | null) || 0)))
    return out.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir
      if (av == null && bv != null) return 1
      if (bv == null && av != null) return -1
      return String(av ?? '').localeCompare(String(bv ?? '')) * sort.dir
    })
  }, [data, sort, faction, filter, changedOnly])
  const toggleSort = (key: string) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))
  const arrow = (key: string) => sort.key === key ? (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : null

  return (
    <div className={styles.root}>
      <div className={styles.filters}>
        <input type="search" placeholder="filter by name…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <select value={faction} onChange={(e) => setFaction(e.target.value)}><option value="">all factions</option>{factions.map((f) => <option key={f}>{f}</option>)}</select>
        <label className={styles.check}><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> changed only</label>
        <span className="muted">{rows.length} of {data.rows.length} units with abilities</span>
      </div>
      <div className={styles.scroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th rowSpan={2} className={styles.sortable} onClick={() => toggleSort('name')}>name {arrow('name')}</th>
              <th rowSpan={2} className={styles.sortable} onClick={() => toggleSort('faction')}>faction {arrow('faction')}</th>
              <th rowSpan={2}>abilities</th>
              {data.headline.map((h) => <th key={h} colSpan={3} className={styles.group}>{humanKey(h)}</th>)}
            </tr>
            <tr>
              {data.headline.map((h) => (
                <Fragment key={h}>
                  <th className={styles.num}>base</th>
                  <th className={styles.num}>buffed</th>
                  <th className={`${styles.num} ${styles.sortable}`} onClick={() => toggleSort(`${h}_pct`)}>Δ % {arrow(`${h}_pct`)}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const missing = (r.missingAbilities as string[]) ?? []
              const abilities = (r.abilities as string[]) ?? []
              return (
                <tr key={String(r.name)}>
                  <td>
                    <button type="button" className={styles.link} onClick={() => { setMode('buffs'); openEntity(String(r.name)) }} title="Open the unit's Buff impact tab">{String(r.name)}</button>
                  </td>
                  <td><span className={styles.swatch} style={{ background: factionColor(String(r.race ?? RACE_OF[String(r.faction)] ?? '')) }} />{String(r.faction ?? '')}</td>
                  <td className={styles.abilities} title={abilities.join('\n')}>
                    {abilities.map((a) => <span key={a} className={styles.ab} data-missing={missing.includes(a) || undefined}>{a.replace(/^Ability_?/, '')}</span>)}
                    {(r.unmodelled as number) > 0 && <span className={styles.ab} data-warn="">{r.unmodelled as number} unmodelled</span>}
                  </td>
                  {data.headline.map((h) => {
                    const pct = r[`${h}_pct`] as number | null
                    const tone = pct ? (pct > 0 ? 'pos' : 'neg') : undefined
                    return (
                      <Fragment key={h}>
                        <td className={styles.num}>{fmtNum(r[`${h}_base`], 2)}</td>
                        <td className={styles.num} data-changed={tone ? '' : undefined}>{r[`${h}_buffed`] === null ? '∞' : fmtNum(r[`${h}_buffed`], 2)}</td>
                        <td className={styles.num} data-sign={tone}>{pct ? fmtPct(pct) : '–'}</td>
                      </Fragment>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
