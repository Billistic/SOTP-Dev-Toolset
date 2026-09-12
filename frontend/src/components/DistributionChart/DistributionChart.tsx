import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useUiStore } from '@/store/useUiStore'
import { cssVar, useResolvedTheme } from '@/hooks/useTheme'
import type { Distribution } from '@/types/api'
import styles from './DistributionChart.module.css'

const PALETTE_VARS = ['--accent', '--covenant', '--success', '--warning', '--error', '--info', '--neutral']

/** Sorted bar chart of one numeric field, one bar per entity, coloured by group; click a bar to open the entity. */
export function DistributionChart({ data }: { data: Distribution }) {
  const openEntity = useUiStore((s) => s.openEntity)
  const theme = useResolvedTheme()
  const palette = useMemo(() => PALETTE_VARS.map(cssVar), [theme])   // recharts needs literal colours; re-read per theme
  const groups = useMemo(() => Object.keys(data.groups), [data])
  const colour = (g: string | null) => palette[Math.max(0, groups.indexOf(g ?? '(none)')) % palette.length]
  const points = useMemo(() => [...data.points].sort((a, b) => a.value - b.value), [data])
  const groupKey = (p: Distribution['points'][number]) => (groups.includes(p.faction ?? '') ? p.faction : p.role) ?? '(none)'

  return (
    <div className={styles.root}>
      <div className={styles.legend}>
        {groups.map((g) => <span key={g}><i style={{ background: colour(g) }} />{g}</span>)}
        <span className="muted">{points.length} entities · median {data.overall.median?.toFixed(2)}</span>
      </div>
      <div className={styles.chart}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} angle={-60} textAnchor="end" interval={points.length > 60 ? Math.ceil(points.length / 60) : 0} height={60} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} width={64} />
            <Tooltip cursor={{ fill: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }} contentStyle={{ background: 'var(--bg-overlay)', border: '1px solid var(--border-default)', fontSize: 12 }}
                     labelStyle={{ color: 'var(--text-primary)' }} formatter={(v: number) => [v, data.path]} />
            <Bar dataKey="value" onClick={(d) => d && openEntity((d as unknown as { name: string }).name)} cursor="pointer" isAnimationActive={false}>
              {points.map((p) => <Cell key={p.name} fill={colour(groupKey(p))} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
