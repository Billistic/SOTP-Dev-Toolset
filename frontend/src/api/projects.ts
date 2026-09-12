import { api, qs } from './client'
import type { DiagnosticsSummary, IngestStats, Project } from '@/types/api'

export interface BrowseResult {
  path: string
  parent: string | null
  dirs: string[]
  isModRoot: boolean
}

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),
  active: () => api.get<Project>('/projects/active'),
  create: (body: { name: string; modRoot: string; vanillaRoot?: string; outputRoot?: string }) =>
    api.post<Project>('/projects', body),
  update: (id: number, body: Partial<{ name: string; modRoot: string; vanillaRoot: string; outputRoot: string }>) =>
    api.put<Project>(`/projects/${id}`, body),
  activate: (id: number) => api.post<Project>(`/projects/${id}/activate`),
  remove: (id: number) => api.del<void>(`/projects/${id}`),
  ingest: (id: number, force = false) => api.post<IngestStats>(`/projects/${id}/ingest${qs({ force })}`),
  validate: (id: number) => api.post<DiagnosticsSummary>(`/projects/${id}/validate`),
  browse: (path: string) => api.get<BrowseResult>(`/projects/browse${qs({ path })}`),
}
