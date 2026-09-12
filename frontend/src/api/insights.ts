import { api, qs } from './client'
import type { BalanceReport, Distribution, FieldCatalogEntry, Graph, GraphLayout, MetricTable, RelGraph } from '@/types/api'

export interface Overview {
  types: { entityType: string; category: string; count: number; errors: number }[]
  factions: { race: string | null; faction: string | null; count: number }[]
  strings: number
  diagnostics: Record<string, number>
}

export const insightsApi = {
  overview: () => api.get<Overview>('/analytics/overview'),
  fieldCatalog: (entityType: string) => api.get<FieldCatalogEntry[]>(`/analytics/fields/${entityType}`),
  distribution: (entityType: string, path: string, groupBy = 'faction') =>
    api.get<Distribution>(`/analytics/distribution${qs({ entity_type: entityType, path, group_by: groupBy })}`),
  metricCatalog: () => api.get<Record<string, string[]>>('/analytics/metrics'),
  metricTable: (category: string, entityType?: string) =>
    api.get<MetricTable>(`/analytics/metrics/${category}${qs({ entity_type: entityType })}`),
  weapons: () => api.get<{ rows: Record<string, unknown>[] }>('/analytics/weapons'),
  research: () => api.get<{ tiers: Record<string, unknown>[]; modifiers: Record<string, unknown>[] }>('/analytics/research'),
  recommendations: (p: { category?: string; z?: number; min_group?: number; entity_type?: string; reachable_only?: boolean } = {}) =>
    api.get<BalanceReport>(`/balance/recommendations${qs(p)}`),
  symmetry: (category = 'ship') => api.get<Record<string, unknown>[]>(`/balance/symmetry${qs({ category })}`),
  researchGraph: (player: string) => api.get<Graph>(`/graph/research/${encodeURIComponent(player)}`),
  neighbourhood: (name: string, depth = 1) => api.get<Graph>(`/graph/neighbourhood/${encodeURIComponent(name)}${qs({ depth })}`),
  relationships: (p: { categories?: string; focus?: string; depth?: number; direction?: 'out' | 'in' | 'both'; incoming?: boolean; include?: string; factions?: string; asset_kinds?: string; max_nodes?: number }) =>
    api.get<RelGraph>(`/graph/relationships${qs(p)}`),
  getLayout: (viewKey: string) => api.get<GraphLayout>(`/graph/layout/${encodeURIComponent(viewKey)}`),
  saveLayout: (viewKey: string, positions: Record<string, { x: number; y: number }>, merge = true) =>
    api.put<GraphLayout>(`/graph/layout/${encodeURIComponent(viewKey)}`, { positions, merge }),
  clearLayout: (viewKey: string) => api.del<void>(`/graph/layout/${encodeURIComponent(viewKey)}`),
  writeDirty: (mode = 'preserve') => api.post<{ written: string[] }>(`/export/write-dirty${qs({ mode })}`),
  writeManifest: () => api.post<{ written: string }>('/export/manifest'),
  csvUrl: (entityType: string) => `/api/export/csv/${entityType}`,
}
