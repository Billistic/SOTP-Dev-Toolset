import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronRight, ExternalLink, RotateCcw, Users } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useUiStore } from '@/store/useUiStore'
import { fmtNum, fmtPct, humanKey } from '@/utils/format'
import type { BuffImpact, BuffMetric, BuffModifier, ChainBuff } from '@/types/api'
import styles from './BuffImpactPanel.module.css'

const HULL_STEPS = [100, 90, 80, 75, 70, 60, 50, 40, 30, 25, 20, 10, 5]

/**
 * What this unit's own abilities do to its numbers: the ability -> buff chain with each buff switchable,
 * a simulated hull level for conditional buffs, base vs buffed metrics, and where the buffed unit sits
 * among its peers (robust z, peers put through the same scenario).  Analytics tables stay unbuffed.
 */
export function BuffImpactPanel({ name }: { name: string }) {
  const openEntity = useUiStore((s) => s.openEntity)
  const [level, setLevel] = useState(0)
  const [hull, setHull] = useState(100)
  const [manual, setManual] = useState<Set<string> | null>(null)   // null = derived from hull / conditions
  const [showAll, setShowAll] = useState(false)
  const params = { level, hull: hull / 100, active: manual ? ([...manual].join(',') || '-') : undefined }
  const { data, isLoading, error } = useQuery({ queryKey: ['entity', name, 'buffs', params], queryFn: () => entitiesApi.buffs(name, params), placeholderData: (p) => p })

  const byAbility = useMemo(() => {
    const m = new Map<string, ChainBuff[]>()
    for (const b of data?.chain ?? []) m.set(b.ability, [...(m.get(b.ability) ?? []), b])
    return m
  }, [data])
  const active = useMemo(() => new Set(data?.active ?? []), [data])
  const toggle = (b: ChainBuff) => {
    const next = new Set(manual ?? active)
    if (next.has(b.id)) {   // switching a parent off takes its descendants with it
      for (const c of data?.chain ?? []) if (c.id === b.id || c.id.startsWith(b.id + '/')) next.delete(c.id)
    } else next.add(b.id)
    setManual(next)
  }

  if (isLoading || !data) return <p className={styles.hint}>{error ? error.message : 'Loading…'}</p>
  if (!data.abilities.length) return <p className={styles.hint}>This unit has no abilities, so nothing changes its numbers at run time.</p>
  const changed = data.metrics.filter((m) => m.delta && m.delta.abs !== 0)
  const unchanged = data.metrics.length - changed.length
  const rows = showAll ? data.metrics : changed

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span>Ability level</span>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {Array.from({ length: data.levels }, (_, i) => <option key={i} value={i}>{i}{i === 0 && data.levels > 1 ? ' (first rank)' : ''}</option>)}
          </select>
        </label>
        <label className={styles.control} title="Buffs that trigger below a hull percentage switch on as this drops">
          <span>Simulated hull</span>
          <select value={hull} onChange={(e) => { setHull(Number(e.target.value)); setManual(null) }}>
            {HULL_STEPS.map((h) => <option key={h} value={h}>{h}%</option>)}
          </select>
        </label>
        <span className={styles.state} data-manual={manual ? '' : undefined}>
          {active.size} buff{active.size === 1 ? '' : 's'} on · {manual ? 'manual' : 'auto'}
          {manual && <button type="button" className={styles.link} onClick={() => setManual(null)}><RotateCcw size={11} /> auto</button>}
        </span>
        <span className={styles.spacer} />
        {data.peers && (
          <span className={styles.peers} title={data.peers.names.join('\n')}>
            <Users size={12} /> peers: {data.peers.group} · {data.peers.count}
          </span>
        )}
      </div>

      <div className={styles.columns}>
        <section className={styles.chain}>
          <h4 className={styles.h}>Abilities</h4>
          {data.abilities.map((a) => (
            <div key={a.slot} className={styles.ability}>
              <header className={styles.abilityHead}>
                <span className={styles.slot}>{a.slot}</span>
                {a.exists
                  ? <button type="button" className={styles.entityLink} onClick={() => openEntity(a.name)} title="Open the ability">{a.name} <ExternalLink size={11} /></button>
                  : <span className={styles.entityMissing} title="Not in the mod: inherited from the base game, so its buffs cannot be read here">{a.name}</span>}
                {a.exists && a.useCost && <span className={styles.badge}>{a.useCost}</span>}
                {a.exists && a.autoCast && <span className={styles.badge}>autocast</span>}
              </header>
              {!a.exists && <p className={styles.note}><AlertTriangle size={12} /> Base-game ability: index a vanilla root in Project settings to follow it.</p>}
              <ul className={styles.buffs}>
                {(byAbility.get(a.name) ?? []).map((b) => <BuffRow key={b.id} buff={b} on={active.has(b.id)} level={data.level} onToggle={() => toggle(b)} onOpen={() => openEntity(b.name)} />)}
                {a.exists && !(byAbility.get(a.name) ?? []).length && <li className={styles.muted}>applies no buff</li>}
              </ul>
            </div>
          ))}
          {data.unmodelled.length > 0 && (
            <p className={styles.note}>
              <AlertTriangle size={12} /> Not modelled (shown but not applied): {data.unmodelled.map((u) => `${u.type} ${fmtMod(u.value, 'pct')} (${u.buff})`).join('; ')}
            </p>
          )}
        </section>

        <section className={styles.compare}>
          <h4 className={styles.h}>Impact{changed.length ? ` · ${changed.length} metric${changed.length === 1 ? '' : 's'} change` : ' · nothing changes'}</h4>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Metric</th><th className={styles.num}>Base</th><th className={styles.num}>With buffs</th><th className={styles.num}>Δ %</th>
                <th className={styles.num} title="Robust z (median / MAD) of the buffed value among peers put through the same scenario; base z in brackets when it differs">z vs peers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => <MetricRow key={m.metric} m={m} />)}
              {rows.length === 0 && <tr><td colSpan={5} className={styles.empty}>No metric changes under this scenario.</td></tr>}
            </tbody>
          </table>
          {unchanged > 0 && (
            <button type="button" className={styles.more} onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
              <ChevronRight size={12} className={styles.chev} data-open={showAll || undefined} /> {showAll ? 'Hide' : 'Show'} {unchanged} unchanged metric{unchanged === 1 ? '' : 's'}
            </button>
          )}
          <TotalsNote data={data} />
        </section>
      </div>
    </div>
  )
}

function MetricRow({ m }: { m: BuffMetric }) {
  const d = m.delta
  const sign = d && d.abs ? (d.abs > 0 ? 'pos' : 'neg') : undefined
  const tone = sign ? (better(m.metric, d!.abs!) ? 'good' : 'bad') : undefined
  const z = m.peer?.zBuffed ?? null
  const zBase = m.peer?.zBase ?? null
  const zTone = z === null ? undefined : Math.abs(z) >= 2 ? 'strong' : Math.abs(z) >= 1 ? 'mild' : undefined
  return (
    <tr data-changed={sign ? '' : undefined} data-tone={zTone}>
      <td title={NOTES[m.metric] ?? m.metric}>{humanKey(m.metric)}</td>
      <td className={styles.num}>{fmtNum(m.base, 3)}</td>
      <td className={styles.num}><strong>{m.buffed === null ? '∞' : fmtNum(m.buffed, 3)}</strong></td>
      <td className={styles.num} data-tone={tone}>{d?.pct ? fmtPct(d.pct) : '–'}</td>
      <td className={styles.num} data-sign={z === null ? undefined : z > 0 ? 'pos' : z < 0 ? 'neg' : undefined}
          title={m.peer ? `peer median: ${fmtNum(m.peer.medianBuffed, 3)} (base ${fmtNum(m.peer.medianBase, 3)}) · percentile ${m.peer.percentileBuffed ?? '–'}` : ''}>
        {z === null ? '–' : (z > 0 ? '+' : '') + z.toFixed(2)}
        {zBase !== null && z !== null && zBase !== z && <span className={styles.zBase}> ({zBase > 0 ? '+' : ''}{zBase.toFixed(2)})</span>}
      </td>
    </tr>
  )
}

function BuffRow({ buff: b, on, level, onToggle, onOpen }: { buff: ChainBuff; on: boolean; level: number; onToggle: () => void; onOpen: () => void }) {
  const selfish = b.appliesTo !== 'target'
  const modelled = b.modifiers.filter((m) => m.modelled)
  const other = [...b.modifiers.filter((m) => !m.modelled).map((m) => m.type), ...b.boolModifiers, ...b.otherActions].filter(Boolean)
  const when = [b.condition ? condText(b.condition, level) : null, ...b.finish.map((f) => finishText(f, level))].filter(Boolean).join(' · ')
  return (
    <li className={styles.buff} style={{ marginLeft: b.depth * 16 }} data-on={on || undefined} data-target={!selfish || undefined}>
      <label className={styles.buffHead} title={!b.exists ? 'Not in the mod (base game)' : !selfish ? 'Applied to other units, so it does not change this one' : b.via}>
        <input type="checkbox" checked={on} disabled={!b.exists || !selfish} onChange={onToggle} />
        <button type="button" className={styles.entityLink} onClick={(e) => { e.preventDefault(); onOpen() }} disabled={!b.exists}>{b.name}</button>
        {!selfish && <span className={styles.target}>→ targets</span>}
        {modelled.map((m, i) => <span key={i} className={styles.mod} data-on={on || undefined} title={m.label}>{m.type} <b>{fmtMod(m.value, m.mode)}</b></span>)}
        {modelled.length === 0 && <span className={styles.noStat}>{other.length ? other.join(', ') : 'no stat change'}</span>}
      </label>
      {when && <div className={styles.when}>{when}</div>}
    </li>
  )
}

function TotalsNote({ data }: { data: BuffImpact }) {
  const entries = Object.entries(data.totals)
  if (!entries.length) return <p className={styles.footnote}>No modelled modifier is active: the numbers are the file values.</p>
  return (
    <p className={styles.footnote}>
      Applied: {entries.map(([k, v]) => `${k} ${fmtMod(v, 'pct')}`).join(' · ')}. Same-type fractions are summed, then multiplied; frontal EHP assumes every hit lands in the forward arc.
      z uses median / MAD (robust to outliers); rows shaded at |z| ≥ 1 and ≥ 2. Peers carry their own buffs under the same hull / level.
    </p>
  )
}

const NOTES: Record<string, string> = {
  ehp_frontal: 'Effective HP when all incoming fire arrives from the front (DamageAsDamageTargetFromForward)',
  ehp: 'hull × (1 + armour × weight) + shield',
}
const HIGHER_IS_BETTER = new Set(['hull', 'shield', 'armor', 'ehp', 'ehp_frontal', 'hull_regen', 'shield_regen', 'mitigation', 'antimatter',
  'antimatter_regen', 'speed', 'acceleration', 'turn_rate', 'dps_total', 'dps_all_banks', 'dps_anti_fighter', 'max_range', 'dps_per_cost', 'ehp_per_cost', 'dps_per_supply'])
const better = (metric: string, delta: number) => (HIGHER_IS_BETTER.has(metric) ? delta > 0 : delta < 0)

function fmtMod(v: number | null, mode: BuffModifier['mode']) {
  if (v === null) return '?'
  if (mode === 'add') return `${v > 0 ? '+' : ''}${fmtNum(v, 3)}`
  return `${v > 0 ? '+' : ''}${(v * 100).toFixed(v * 100 % 1 ? 1 : 0)}%`
}
const at = (values: (number | null)[], level: number) => values[Math.min(level, values.length - 1)] ?? null
function condText(c: { type: string; values: (number | null)[] }, level: number) {
  const v = at(c.values, level)
  if (c.type === 'IfOwnerHasHullLessThanPerc') return `when hull < ${v === null ? '?' : Math.round(v * 100)}%`
  if (c.type === 'IfOwnerHasHullGreaterThanPerc') return `when hull > ${v === null ? '?' : Math.round(v * 100)}%`
  return `when ${c.type}${v !== null ? ` ${fmtNum(v, 3)}` : ''}`
}
function finishText(f: { type: string; values: (number | null)[] }, level: number) {
  const v = at(f.values, level)
  if (f.type === 'TimeElapsed') return `for ${v === null ? '?' : fmtNum(v, 1)} s`
  if (f.type === 'OwnerHullAbovePerc') return `until hull > ${v === null ? '?' : Math.round(v * 100)}%`
  if (f.type === 'DamageTaken') return 'until damaged'
  return `until ${f.type}${v !== null ? ` ${fmtNum(v, 3)}` : ''}`
}
