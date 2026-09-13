import { create } from 'zustand'

/** Native window state mirrored from the desktop shell (title bar buttons and edge-resize zones share it). */
interface WindowState {
  maximized: boolean
  setMaximized: (v: boolean) => void
}
export const useWindowStore = create<WindowState>()((set) => ({ maximized: false, setMaximized: (maximized) => set({ maximized }) }))
