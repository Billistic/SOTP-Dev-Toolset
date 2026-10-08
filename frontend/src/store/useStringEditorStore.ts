import { create } from 'zustand'

/** Which string ID the global string editor modal is showing (null = closed). */
interface StringEditorState {
  stringId: string | null
  isNew: boolean
  file: string | undefined          // .str file to edit; undefined = the primary English.str
  open: (stringId: string, isNew?: boolean, file?: string) => void
  close: () => void
}

export const useStringEditorStore = create<StringEditorState>()((set) => ({
  stringId: null,
  isNew: false,
  file: undefined,
  open: (stringId, isNew = false, file) => set({ stringId, isNew, file }),
  close: () => set({ stringId: null, isNew: false, file: undefined }),
}))
