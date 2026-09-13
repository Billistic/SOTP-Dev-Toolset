import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, RotateCcw, Zap } from 'lucide-react'
import { entitiesApi } from '@/api/entities'
import { useUiStore } from '@/store/useUiStore'
import { fmtNum, fmtPct, humanKey } from '@/utils/format'
import type { BuffImpact, BuffModifier, ChainBuff } from '@/types/api'
import styles from './BuffImpactPanel.module.css'

const HULL_STEPS = [100, 90, 80, 75, 70, 60, 50, 40, 30, 25, 20, 10, 5]

/**
 * What this unit's own abilities do to its numbers: the ability -> buff chain with each buff
 * switchable, a simulated hull level for conditional buffs, and base vs buffed metrics.
 * The Analytics tables stay unbuffed; this view is the "with abilities" lens beside them.
 */
export function BuffImpactPanel({ name }: { name: string }) {
  const openEntity = useUiStore((s) => s.openEntity)
  const [level, setLevel] = useState(0)
  const [hull, setHull] = useState(100)
  const [manual, setManual] = useState<Set<string> | null>(null)   // null = derived from hull / conditions
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

  return (
    <div className={styles.root}>
      <div className={styles.controls}>
        <label className={styles.control}>
          <span>Ability level</span>
          <select value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {Array.from({ length: data.levels }, (_, i) => <option key={i} value={i}>Level {i}{i === 0 && data.levels > 1 ? ' (first rank)' : ''}</option>)}
          </select>
        </label>
        <label className={styles.control} title="Buffs that trigger below a hull percentage switch on as this drops">
          <span>Simulated hull</span>
          <select value={hull} onChange={(e) => { setHull(Number(e.target.value)); setManual(null) }}>
            {HULL_STEPS.map((h) => <option key={h} value={h}>{h}%</option>)}
          </select>
        </label>
        <span className={styles.mode} data-manual={manual ? '' : undefined}>
          {manual ? 'manual selection' : 'auto: self-buffs whose conditions hold'}
          {manual && <button type="button" className={styles.link} onClick={() => setManual(null)}><RotateCcw size={11} /> back to auto</button>}
        </span>
        <span className={styles.spacer} />
        <span className={styles.summary}>
          <Zap size={12} /> {active.size} buff{active.size === 1 ? '' : 's'} on · {changed.length} metric{changed.length === 1 ? '' : 's'} change
        </span>
      </div>

      <div className={styles.columns}>
        <section className={styles.chain}>
          {data.abilities.map((a) => (
            <div key={a.slot} className={styles.ability}>
              <header className={styles.abilityHead}>
                <span className={styles.slot}>{a.slot}</span>
                {a.exists
                  ? <button type="button" className={styles.entityLink} onClick={() => openEntity(a.name)} title="Open the ability">{a.name} <ExternalLink size={11} /></button>
                  : <span className={styles.entityMissing} title="Not in the mod: inherited from the base game, so its buffs cannot be read here">{a.name}</span>}
                {a.exists && (
                  <span className={styles.badges}>
                    {a.useCost && <span className={styles.badge}>{a.useCost}</span>}
                    {a.trigger && a.trigger !== 'AlwaysPerform' && <span className={styles.badge}>{a.trigger}</span>}
                    {a.autoCast && <span className={styles.badge}>autocast</span>}
                    {a.levelSource && <span className={styles.badge} title="Where the ability's level comes from">{a.levelSource}</span>}
                  </span>
                )}
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
          <table className={styles.table}>
            <thead><tr><th>Metric</th><th className={styles.num}>Base</th><th className={styles.num}>With buffs</th><th className={styles.num}>Δ</th><th className={styles.num}>Δ %</th></tr></thead>
            <tbody>
              {data.metrics.map((m) => {
                const d = m.delta
                const sign = d && d.abs ? (d.abs > 0 ? 'pos' : 'neg') : undefined
                const tone = sign ? (better(m.metric, d!.abs!) ? 'good' : 'bad') : undefined
                return (
                  <tr key={m.metric} data-changed={sign ? '' : undefined}>
                    <td title={NOTES[m.metric]}>{humanKey(m.metric)}</td>
                    <td className={styles.num}>{fmtNum(m.base, 3)}</td>
                    <td className={styles.num}><strong>{m.buffed === null ? '∞' : fmtNum(m.buffed, 3)}</strong></td>
                    <td className={styles.num} data-tone={tone}>{d?.abs ? (d.abs > 0 ? '+' : '') + fmtNum(d.abs, 3) : '–'}</td>
                    <td className={styles.num} data-tone={tone}>{d?.pct ? fmtPct(d.pct) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <TotalsNote data={data} />
        </section>
      </div>
    </div>
  )
}

function BuffRow({ buff: b, on, level, onToggle, onOpen }: { buff: ChainBuff; on: boolean; level: number; onToggle: () => void; onOpen: () => void }) {
  const selfish = b.appliesTo !== 'target'
  return (
    <li className={styles.buff} style={{ marginLeft: b.depth * 18 }} data-on={on || undefined} data-target={!selfish || undefined}>
      <label className={styles.buffHead} title={!b.exists ? 'Not in the mod (base game)' : !selfish ? 'Applied to other units, so it does not change this one' : ''}>
        <input type="checkbox" checked={on} disabled={!b.exists || !selfish} onChange={onToggle} />
        <button type="button" className={styles.entityLink} onClick={(e) => { e.preventDefault(); onOpen() }} disabled={!b.exists}>{b.name}</button>
        <span className={styles.via}>{b.via.replace(/^ApplyBuffTo/, '→ ')}{b.trigger && b.trigger !== 'AlwaysPerform' ? ` · ${b.trigger}` : ''}</span>
        {b.condition && <span className={styles.cond}>{condText(b.condition, level)}</span>}
        {b.finish.map((f, i) => <span key={i} className={styles.cond}>{finishText(f, level)}</span>)}
      </label>
      {(b.modifiers.length > 0 || b.boolModifiers.length > 0 || b.otherActions.length > 0) && (
        <ul className={styles.mods}>
          {b.modifiers.map((m, i) => <li key={i} data-off={!m.modelled || undefined} title={m.label}>{m.type} <strong>{fmtMod(m.value, m.mode)}</strong>{!m.modelled && <em> not modelled</em>}</li>)}
          {b.boolModifiers.map((m) => <li key={m} data-off="">{m}</li>)}
          {b.otherActions.map((a, i) => <li key={`a${i}`} data-off="">{a}</li>)}
        </ul>
      )}
    </li>
  )
}

function TotalsNote({ data }: { data: BuffImpact }) {
  const entries = Object.entries(data.totals)
  if (!entries.length) return <p className={styles.note}>No modelled modifier is active: the numbers are the file values.</p>
  return (
    <p className={styles.note}>
      Applied (same-type fractions summed, then multiplied): {entries.map(([k, v]) => `${k} ${fmtMod(v, 'pct')}`).join(' · ')}.
      {' '}Frontal EHP assumes every hit lands in the forward arc.
    </p>
  )
}

const NOTES: Record<string, string> = {
  ehp_frontal: 'Effective HP when all incoming fire arrives from the front (DamageAsDamageTargetFromForward)',
  ehp: 'hull × (1 + armour × weight) + shield',
}
// metrics where a rise is a good thing for the unit; everything else (mass) the other way round
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
