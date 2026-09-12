import { useEffect, useState } from 'react'
import { useUiStore, type Theme } from '@/store/useUiStore'

export type ResolvedTheme = 'dark' | 'light'
const query = () => window.matchMedia('(prefers-color-scheme: light)')

/** The palette actually in effect ('system' follows the OS) - drives React Flow's colorMode and chart colours. */
export function useResolvedTheme(): ResolvedTheme {
  const theme = useUiStore((s) => s.theme)
  const [system, setSystem] = useState<ResolvedTheme>(() => (query().matches ? 'light' : 'dark'))
  useEffect(() => {
    const mq = query()
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return theme === 'system' ? system : theme
}

/** Stamps `data-theme` on <html> so the CSS tokens switch; mounted once in App. */
export function useApplyTheme() {
  const resolved = useResolvedTheme()
  useEffect(() => { document.documentElement.dataset.theme = resolved }, [resolved])
  return resolved
}

/** Read a CSS token's current value (for libraries that need real colour strings, e.g. recharts). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export const THEME_ORDER: Theme[] = ['dark', 'light', 'system']
