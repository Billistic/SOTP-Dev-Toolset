/** Display helpers shared by tables and panels. */

export const fmtNum = (v: unknown, digits = 2): string => {
  if (v === null || v === undefined || v === '') return '–'
  const n = typeof v === 'number' ? v : Number(v)
  if (Number.isNaN(n)) return String(v)
  if (Number.isInteger(n)) return n.toLocaleString()
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

export const fmtPct = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`)

export const factionColor = (race: string | null | undefined) =>
  race === 'UNSC' ? 'var(--unsc)' : race === 'Covenant' ? 'var(--covenant)'
    : !race || race === 'Neutral' ? 'var(--neutral)'
    : `var(--tier-${[...race].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 9})`   // other mods' races: stable tier hue

export const severityColor = (s: string) =>
  s === 'error' ? 'var(--error)' : s === 'warning' ? 'var(--warning)' : 'var(--info)'

/** Strip the surrounding quotes from a raw Sins string token. */
export const unquote = (raw: string | undefined) =>
  raw === undefined ? '' : raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw

export const humanKey = (key: string) =>
  key.replace(/^m_/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

export const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`)
