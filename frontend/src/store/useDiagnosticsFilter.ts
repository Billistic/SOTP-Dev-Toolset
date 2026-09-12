import { create } from 'zustand'

/** Filter shared between the diagnostics sidebar summary and the diagnostics view. */
interface DiagnosticsFilter {
  severity: string | null
  code: string | null
  scope: string | null
  search: string
  set: (patch: Partial<Omit<DiagnosticsFilter, 'set' | 'reset'>>) => void
  reset: () => void
}

export const useDiagnosticsFilter = create<DiagnosticsFilter>((set) => ({
  severity: null,
  code: null,
  scope: null,
  search: '',
  set: (patch) => set(patch),
  reset: () => set({ severity: null, code: null, scope: null, search: '' }),
}))
