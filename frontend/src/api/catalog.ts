import { api, qs } from './client'
import type { Asset, Diagnostic, DiagnosticsSummary, EntitySchema, GameString, StringChanges, WeaponSchema } from '@/types/api'

export const catalogApi = {
  schemas: () => api.get<{ groups: string[]; schemas: Record<string, EntitySchema> }>('/schemas'),
  weaponSchema: () => api.get<WeaponSchema>('/schemas/weapon'),
  fieldValues: (key: string, entityType?: string) =>
    api.get<string[]>(`/fields/values${qs({ key, entity_type: entityType })}`),
  strings: (p: { search?: string; modified?: boolean; limit?: number; offset?: number } = {}) =>
    api.get<{ total: number; rows: GameString[] }>(`/strings${qs({ limit: 500, ...p })}`),
  getString: (id: string) => api.get<GameString>(`/strings/${encodeURIComponent(id)}`),
  putString: (id: string, value: string, sourceFile = 'String/English.str') =>
    api.put<GameString>(`/strings/${encodeURIComponent(id)}`, { value, sourceFile }),
  deleteString: (id: string) => api.del<void>(`/strings/${encodeURIComponent(id)}`),
  stringChanges: () => api.get<StringChanges>('/strings/changes'),
  revertStrings: (ids?: string[]) => api.post<{ reverted: number }>('/strings/revert', { ids: ids ?? null }),
  writeStrings: () => api.post<{ written: string }>('/strings/write'),
  assets: (p: { kind?: string; search?: string; source?: string; limit?: number } = {}) =>
    api.get<Asset[]>(`/assets${qs({ limit: 500, ...p })}`),
  assetKinds: () => api.get<{ kind: string; source: string; count: number }[]>('/assets/kinds'),
  diagnostics: (p: { severity?: string; code?: string; scope?: string; search?: string; limit?: number } = {}) =>
    api.get<Diagnostic[]>(`/diagnostics${qs({ limit: 2000, ...p })}`),
  diagnosticsSummary: () => api.get<DiagnosticsSummary>('/diagnostics/summary'),
  runDiagnostics: () => api.post<DiagnosticsSummary>('/diagnostics/run'),
}
