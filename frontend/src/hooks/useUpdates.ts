import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { updatesApi } from '@/api/updates'
import { toast } from '@/store/useToastStore'

const SKIP_KEY = 'sotp-skip-version'

/** Update check on launch, background download with progress, one-click restart-to-install. */
export function useUpdates(autoCheck = true) {
  const qc = useQueryClient()
  const [skipped, setSkipped] = useState<string | null>(() => { try { return localStorage.getItem(SKIP_KEY) } catch { return null } })

  const info = useQuery({ queryKey: ['updates', 'check'], queryFn: () => updatesApi.check(), enabled: autoCheck, retry: false, staleTime: 30 * 60_000 })
  const status = useQuery({
    queryKey: ['updates', 'status'], queryFn: updatesApi.status, retry: false,
    refetchInterval: (q) => (q.state.data?.state === 'downloading' || q.state.data?.state === 'verifying' ? 500 : false),
  })
  const check = useMutation({
    mutationFn: () => updatesApi.check(true),
    onSuccess: (d) => { qc.setQueryData(['updates', 'check'], d); if (!d.available) toast.info(d.error ? `Update check failed: ${d.error}` : `You are on the latest version (${d.current})`) },
  })
  const download = useMutation({
    mutationFn: updatesApi.download,
    onSuccess: (d) => { qc.setQueryData(['updates', 'status'], d); qc.invalidateQueries({ queryKey: ['updates', 'status'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const install = useMutation({
    mutationFn: updatesApi.install,
    onSuccess: (r) => { if (!r.ok) toast.error(r.error ?? 'Could not start the installer') },
    onError: (e: Error) => toast.error(e.message),
  })
  useEffect(() => { if (status.data?.state === 'failed' && status.data.error) toast.error(`Update failed: ${status.data.error}`) }, [status.data?.state, status.data?.error])

  const skip = (version: string) => { try { localStorage.setItem(SKIP_KEY, version) } catch { /* private mode */ } setSkipped(version) }
  const available = !!info.data?.available && info.data.latest !== skipped
  return { info: info.data, status: status.data, available, check, download, install, skip, skipped }
}
