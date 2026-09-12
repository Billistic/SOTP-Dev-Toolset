import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityBar } from '@/layout/ActivityBar/ActivityBar'
import { Sidebar } from '@/layout/Sidebar/Sidebar'
import { EditorArea } from '@/layout/EditorArea/EditorArea'
import { BottomPanel } from '@/layout/BottomPanel/BottomPanel'
import { StatusBar } from '@/layout/StatusBar/StatusBar'
import { ToastStack } from '@/components/ToastStack/ToastStack'
import { StringEditorModal } from '@/components/StringEditorModal/StringEditorModal'
import { useUiStore } from '@/store/useUiStore'
import { useApplyTheme } from '@/hooks/useTheme'
import styles from './App.module.css'

const MIN_SIDEBAR = 200
const MAX_SIDEBAR = 560
const MIN_BOTTOM = 100

export function App() {
  const { sidebarVisible, sidebarWidth, setSidebarWidth, bottomVisible, bottomHeight, setBottomHeight } = useUiStore()
  const [drag, setDrag] = useState<null | 'sidebar' | 'bottom'>(null)
  useApplyTheme()
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.key === 'b') { e.preventDefault(); useUiStore.getState().toggleSidebar() }
      if (e.key === '`') { e.preventDefault(); useUiStore.getState().toggleBottom() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!drag) return
    const onMove = (e: MouseEvent) => {
      const rect = bodyRef.current?.getBoundingClientRect()
      if (!rect) return
      if (drag === 'sidebar') setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX - rect.left - 48)))
      else setBottomHeight(Math.max(MIN_BOTTOM, Math.min(rect.height - 120, rect.bottom - e.clientY)))
    }
    const onUp = () => setDrag(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [drag, setSidebarWidth, setBottomHeight])

  const startDrag = useCallback((which: 'sidebar' | 'bottom') => (e: React.MouseEvent) => { e.preventDefault(); setDrag(which) }, [])

  return (
    <div className={styles.shell}>
      <div className={styles.body} ref={bodyRef} data-dragging={drag ?? undefined}>
        <ActivityBar />
        {sidebarVisible && (
          <>
            <aside className={styles.sidebar} style={{ width: sidebarWidth }}><Sidebar /></aside>
            <div className={styles.vHandle} onMouseDown={startDrag('sidebar')} role="separator" aria-orientation="vertical" />
          </>
        )}
        <main className={styles.main}>
          <div className={styles.editor}><EditorArea /></div>
          {bottomVisible && (
            <>
              <div className={styles.hHandle} onMouseDown={startDrag('bottom')} role="separator" aria-orientation="horizontal" />
              <div className={styles.bottom} style={{ height: bottomHeight }}><BottomPanel /></div>
            </>
          )}
        </main>
      </div>
      <StatusBar />
      <StringEditorModal />
      <ToastStack />
    </div>
  )
}
