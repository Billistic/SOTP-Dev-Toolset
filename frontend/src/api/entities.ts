import { api, qs } from './client'
import type {
  BuffImpact, Diagnostic, EditChange, EntityDetail, EntitySummary, IncomingReference, PeerProfile, Reference, TypeCount,
} from '@/types/api'

export interface EntityFilters {
  entity_type?: string
  category?: string
  faction?: string
  race?: string
  search?: string
  dirty?: boolean
  errors?: boolean
  limit?: number
}

const enc = encodeURIComponent

export const entitiesApi = {
  list: (f: EntityFilters = {}) => api.get<EntitySummary[]>(`/entities${qs({ limit: 5000, ...f })}`),
  types: () => api.get<TypeCount[]>('/entities/types'),
  get: (name: string) => api.get<EntityDetail>(`/entities/${enc(name)}`),
  text: (name: string, mode: 'preserve' | 'pretty' = 'preserve') => api.get<string>(`/entities/${enc(name)}/text${qs({ mode })}`),
  putText: (name: string, text: string) => api.put<EntityDetail>(`/entities/${enc(name)}/text`, { text }),
  edit: (name: string, changes: EditChange[]) => api.post<EntityDetail>(`/entities/${enc(name)}/edits`, { changes }),
  revert: (name: string) => api.post<EntityDetail>(`/entities/${enc(name)}/revert`),
  write: (name: string, mode: 'preserve' | 'pretty' = 'preserve') =>
    api.post<{ written: string; entity: EntitySummary }>(`/entities/${enc(name)}/write${qs({ mode })}`),
  create: (body: { name: string; text?: string; template?: string; ownStrings?: boolean }) =>
    api.post<EntityDetail>('/entities', body),
  remove: (name: string, moveFile = true) =>
    api.del<{ deleted: string; movedTo: string | null }>(`/entities/${enc(name)}${qs({ move_file: moveFile })}`),
  references: (name: string) => api.get<Reference[]>(`/entities/${enc(name)}/references`),
  referencedBy: (name: string) => api.get<IncomingReference[]>(`/entities/${enc(name)}/referenced-by`),
  diagnostics: (name: string) => api.get<Diagnostic[]>(`/entities/${enc(name)}/diagnostics`),
  peers: (name: string) => api.get<PeerProfile>(`/entities/${enc(name)}/peers`),
  buffs: (name: string, p: { level?: number; hull?: number; active?: string } = {}) => api.get<BuffImpact>(`/entities/${enc(name)}/buffs${qs(p)}`),
  setManifest: (name: string, listed: boolean) =>
    api.put<{ listed: boolean; changed: boolean; entity: EntityDetail }>(`/entities/${enc(name)}/manifest`, { listed }),
  players: (name: string) =>
    api.get<{ player: string; slot: string; page: string | null; ordinal: number }[]>(`/entities/${enc(name)}/players`),
}
