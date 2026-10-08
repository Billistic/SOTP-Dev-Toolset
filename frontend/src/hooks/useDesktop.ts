import { useEffect, useState } from 'react'

interface WindowApi {
  minimize: () => Promise<void>
  toggle_maximize: () => Promise<boolean>
  is_maximized: () => Promise<boolean>
  close: () => Promise<void>
  start_drag: () => Promise<boolean>              // Windows' own move loop: Snap, Win+arrow, FancyZones
  start_resize: (edge: string) => Promise<boolean>
}
declare global {
  interface Window { pywebview?: { api: WindowApi } }
}

/** True inside the desktop shell (pywebview injects window.pywebview once the bridge is ready). */
export function useDesktop() {
  const [api, setApi] = useState<WindowApi | null>(() => window.pywebview?.api ?? null)
  useEffect(() => {
    if (api) return
    const onReady = () => setApi(window.pywebview?.api ?? null)
    window.addEventListener('pywebviewready', onReady)
    const t = window.setTimeout(onReady, 800)   // in case the event fired before React mounted
    return () => { window.removeEventListener('pywebviewready', onReady); window.clearTimeout(t) }
  }, [api])
  useEffect(() => { document.documentElement.dataset.desktop = api ? 'true' : undefined }, [api])
  return api
}
