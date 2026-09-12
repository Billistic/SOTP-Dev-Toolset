import { Files, GitBranch, Languages, Package, ShieldAlert, BarChart3, Scale, Settings, Workflow, Sun, Moon, Monitor } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { catalogApi } from '@/api/catalog'
import { useUiStore, type ActivityView } from '@/store/useUiStore'
import { THEME_ORDER } from '@/hooks/useTheme'
import styles from './ActivityBar.module.css'

const ITEMS: { id: ActivityView; label: string; Icon: typeof Files }[] = [
  { id: 'explorer', label: 'Entities', Icon: Files },
  { id: 'research', label: 'Research tree', Icon: GitBranch },
  { id: 'relationships', label: 'Relationships', Icon: Workflow },
  { id: 'strings', label: 'Strings', Icon: Languages },
  { id: 'assets', label: 'Assets', Icon: Package },
  { id: 'diagnostics', label: 'Diagnostics', Icon: ShieldAlert },
  { id: 'analytics', label: 'Analytics', Icon: BarChart3 },
  { id: 'balance', label: 'Balance', Icon: Scale },
]

export function ActivityBar() {
  const activity = useUiStore((s) => s.activity)
  const setActivity = useUiStore((s) => s.setActivity)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const nextTheme = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length]
  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  const { data: summary } = useQuery({ queryKey: ['diagnostics', 'summary'], queryFn: catalogApi.diagnosticsSummary, retry: false })
  const errors = summary?.bySeverity?.error ?? 0

  return (
    <nav className={styles.bar} aria-label="Primary">
      {ITEMS.map(({ id, label, Icon }) => (
        <button key={id} className={styles.item} data-active={activity === id || undefined} title={label}
                onClick={() => setActivity(id)} aria-label={label}>
          <Icon size={20} strokeWidth={1.6} />
          {id === 'diagnostics' && errors > 0 && <span className={styles.badge}>{errors > 99 ? '99+' : errors}</span>}
        </button>
      ))}
      <div className={styles.spacer} />
      <button className={styles.item} onClick={() => setTheme(nextTheme)} title={`Theme: ${theme} (click for ${nextTheme})`} aria-label="Switch theme">
        <ThemeIcon size={18} strokeWidth={1.6} />
      </button>
      <button className={styles.item} data-active={activity === 'project' || undefined} title="Project settings"
              onClick={() => setActivity('project')} aria-label="Project settings">
        <Settings size={20} strokeWidth={1.6} />
      </button>
    </nav>
  )
}
