import { api, qs } from './client'

export interface UpdateInfo {
  current: string
  latest: string | null
  available: boolean
  notes: string
  url: string | null
  size: number | null
  sha256: string | null
  publishedAt: string | null
  releaseUrl: string | null
  checkedAt: number | null
  error: string | null
  supported: boolean       // false in the dev server: installing only works from the desktop build
  repo: string
}

export interface DownloadState {
  state: 'idle' | 'downloading' | 'verifying' | 'ready' | 'failed' | 'installing'
  received: number
  total: number | null
  path: string | null
  error: string | null
  signature: string | null
}

export const updatesApi = {
  check: (force = false) => api.get<UpdateInfo>(`/updates/check${qs({ force: force || undefined })}`),
  download: () => api.post<DownloadState>('/updates/download'),
  status: () => api.get<DownloadState>('/updates/status'),
  install: () => api.post<{ ok: boolean; error?: string }>('/updates/install'),
}
