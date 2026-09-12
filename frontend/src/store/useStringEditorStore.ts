import { create } from 'zustand'

/** Which string ID the global string editor modal is showing (null = closed). */
interface StringEditorState {
  stringId: string | null
  isNew: boolean
  open: (stringId: string, isNew?: boolean) => void
  close: () => void
}

export const useStringEditorStore = create<StringEditorState>()((set) => ({
  stringId: null,
  isNew: false,
  open: (stringId, isNew = false) => set({ stringId, isNew }),
  close: () => set({ stringId: null, isNew: false }),
}))
