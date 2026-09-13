import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { entitiesApi } from '@/api/entities'
import { tabId, useUiStore, type Tab } from '@/store/useUiStore'
import styles from './TabBar.module.css'

const VIEW_LABELS: Record<string, string> = {
  research: 'Research tree', relationships: 'Relationships', strings: 'Strings', assets: 'Assets', diagnostics: 'Diagnostics',
  analytics: 'Analytics', balance: 'Balance', project: 'Project',
}

function label(t: Tab) {
  return t.kind === 'entity' ? t.name : VIEW_LABELS[t.view] ?? t.view
}

/**
 * Open tabs in a horizontally scrolling strip.  When they overflow, a chevron on each side shows how
 * many are hidden that way and scrolls them into view; the active tab is always scrolled into view.
 */
export function TabBar() {
  const { tabs, activeTab, setActiveTab, closeTab } = useUiStore()
  const { data: dirty } = useQuery({ queryKey: ['entities', 'dirty'], queryFn: () => entitiesApi.list({ dirty: true }), retry: false })
  const dirtyNames = new Set((dirty ?? []).map((e) => e.name))
  const strip = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState({ left: 0, right: 0 })

  // count tabs fully out of view on each side
  const measure = useCallback(() => {
    const el = strip.current
    if (!el) return
    const box = el.getBoundingClientRect()
    let left = 0, right = 0
    for (const child of el.children) {
      const r = child.getBoundingClientRect()
      if (r.right <= box.left + 1) left++
      else if (r.left >= box.right - 1) right++
    }
    setHidden((h) => (h.left === left && h.right === right ? h : { left, right }))
  }, [])
  useLayoutEffect(() => {
    measure()
    const el = strip.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', measure) }
  }, [measure, tabs.length])
  useEffect(() => {   // keep the active tab visible
    const el = strip.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    measure()
  }, [activeTab, measure])

  const scrollBy = (dir: -1 | 1) => strip.current?.scrollBy({ left: dir * Math.max(160, (strip.current.clientWidth * 0.6) | 0), behavior: 'smooth' })
  if (!tabs.length) return <div className={styles.bar} />

  return (
    <div className={styles.bar}>
      {hidden.left > 0 && (
        <button type="button" className={styles.edge} onClick={() => scrollBy(-1)} title={`${hidden.left} more tab${hidden.left === 1 ? '' : 's'} to the left`}>
          <ChevronLeft size={14} /><span className={styles.edgeCount}>{hidden.left}</span>
        </button>
      )}
      <div ref={strip} className={styles.strip} role="tablist" onWheel={(e) => { if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.current?.scrollBy({ left: e.deltaY }) } }}>
        {tabs.map((t) => {
          const id = tabId(t)
          const isDirty = t.kind === 'entity' && dirtyNames.has(t.name)
          return (
            <div key={id} role="tab" aria-selected={activeTab === id} className={styles.tab} data-active={activeTab === id || undefined}
                 onClick={() => setActiveTab(id)} onAuxClick={(e) => { if (e.button === 1) closeTab(id) }} title={label(t)}>
              <span className={styles.label} data-kind={t.kind}>{label(t)}</span>
              {isDirty && <span className={styles.dirty} title="Unsaved changes" />}
              <button className={styles.close} onClick={(e) => { e.stopPropagation(); closeTab(id) }} aria-label="Close tab"><X size={13} /></button>
            </div>
          )
        })}
      </div>
      {hidden.right > 0 && (
        <button type="button" className={styles.edge} onClick={() => scrollBy(1)} title={`${hidden.right} more tab${hidden.right === 1 ? '' : 's'} to the right`}>
          <span className={styles.edgeCount}>{hidden.right}</span><ChevronRight size={14} />
        </button>
      )}
    </div>
  )
}
