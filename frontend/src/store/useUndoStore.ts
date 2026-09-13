import { create } from 'zustand'
import { toast } from '@/store/useToastStore'

export interface UndoEntry {
  label: string
  undo: () => unknown | Promise<unknown>
  redo: () => unknown | Promise<unknown>
}

interface UndoState {
  past: UndoEntry[]
  future: UndoEntry[]
  busy: boolean
  push: (entry: UndoEntry) => void
  undo: () => Promise<void>
  redo: () => Promise<void>
  clear: () => void
}

const LIMIT = 50

/**
 * Undo / redo for graph gestures (connections, prerequisite links, tier and slot moves, dragged layouts).
 * Each entry carries its own inverse, so the stack is independent of what the action touched; text
 * fields keep the browser's native undo and are not recorded here.
 */
export const useUndoStore = create<UndoState>()((set, get) => ({
  past: [],
  future: [],
  busy: false,
  push: (entry) => set((s) => ({ past: [...s.past.slice(-(LIMIT - 1)), entry], future: [] })),
  undo: async () => {
    const { past, busy } = get()
    const entry = past[past.length - 1]
    if (!entry || busy) return
    set({ busy: true })
    try {
      await entry.undo()
      set((s) => ({ past: s.past.slice(0, -1), future: [entry, ...s.future] }))
      toast.info(`Undid: ${entry.label}`)
    } catch (e) {
      toast.error(`Undo failed: ${(e as Error).message}`)
    } finally {
      set({ busy: false })
    }
  },
  redo: async () => {
    const { future, busy } = get()
    const entry = future[0]
    if (!entry || busy) return
    set({ busy: true })
    try {
      await entry.redo()
      set((s) => ({ future: s.future.slice(1), past: [...s.past, entry] }))
      toast.info(`Redid: ${entry.label}`)
    } catch (e) {
      toast.error(`Redo failed: ${(e as Error).message}`)
    } finally {
      set({ busy: false })
    }
  },
  clear: () => set({ past: [], future: [] }),
}))

/** True when the key event happened inside something that has its own undo (inputs, editors). */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable || !!el.closest('.cm-editor, .monaco-editor')
}
