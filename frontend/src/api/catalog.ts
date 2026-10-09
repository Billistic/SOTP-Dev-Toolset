import { api, qs } from './client'
import type { Asset, Diagnostic, DiagnosticsSummary, EntitySchema, GameString, StringChanges, WeaponSchema } from '@/types/api'

export const PRIMARY_STR = 'String/English.str'
export const MAX_STRING_LEN = 256   // QA #11: longest Value Sins reads safely; longer ones warn, they are not refused
export const strFileLabel = (file: string) => file.split('/').pop() ?? file

export interface StringFiles {
  primary: string
  maxLength: number
  files: { file: string; count: number; changes: number; tooLong: number; missing?: number; untranslated?: number; orphans?: number }[]
  addable: string[]               // languages the game loads that have no .str file yet
}

export const catalogApi = {
  schemas: () => api.get<{ groups: string[]; schemas: Record<string, EntitySchema> }>('/schemas'),
  weaponSchema: () => api.get<WeaponSchema>('/schemas/weapon'),
  fieldValues: (key: string, entityType?: string) =>
    api.get<string[]>(`/fields/values${qs({ key, entity_type: entityType })}`),
  strings: (p: { search?: string; modified?: boolean; file?: string; too_long?: boolean; vs_primary?: 'untranslated' | 'orphan'; limit?: number; offset?: number } = {}) =>
    api.get<{ total: number; maxLength: number; rows: GameString[] }>(`/strings${qs({ limit: 500, ...p })}`),
  stringFiles: () => api.get<StringFiles>('/strings/files'),
  fillStrings: (file: string) => api.post<{ file: string; added: number }>(`/strings/fill${qs({ file })}`),
  getString: (id: string, file?: string) => api.get<GameString>(`/strings/${encodeURIComponent(id)}${qs({ file })}`),
  putString: (id: string, value: string, sourceFile = PRIMARY_STR) =>
    api.put<GameString>(`/strings/${encodeURIComponent(id)}`, { value, sourceFile }),
  deleteString: (id: string, file?: string) => api.del<void>(`/strings/${encodeURIComponent(id)}${qs({ file })}`),
  stringChanges: () => api.get<StringChanges>('/strings/changes'),
  revertStrings: (ids?: string[], file?: string) => api.post<{ reverted: number }>('/strings/revert', { ids: ids ?? null, file: file ?? null }),
  writeStrings: (file = PRIMARY_STR) => api.post<{ written: string }>(`/strings/write${qs({ source_file: file })}`),
  assets: (p: { kind?: string; search?: string; source?: string; folder?: string; limit?: number } = {}) =>
    api.get<Asset[]>(`/assets${qs({ limit: 500, ...p })}`),
  assetSummary: (p: { kind?: string; search?: string; source?: string } = {}) =>
    api.get<{ total: number; bySource: Record<string, number>; folders: { folder: string; count: number }[] }>(`/assets/summary${qs(p)}`),
  assetKinds: () => api.get<{ kind: string; source: string; count: number }[]>('/assets/kinds'),
  diagnostics: (p: { severity?: string; code?: string; scope?: string; search?: string; limit?: number } = {}) =>
    api.get<Diagnostic[]>(`/diagnostics${qs({ limit: 2000, ...p })}`),
  diagnosticsSummary: () => api.get<DiagnosticsSummary>('/diagnostics/summary'),
  runDiagnostics: () => api.post<DiagnosticsSummary>('/diagnostics/run'),
}
