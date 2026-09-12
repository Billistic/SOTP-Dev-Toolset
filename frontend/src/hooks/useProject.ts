import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '@/api/projects'
import { toast } from '@/store/useToastStore'
import { ApiError } from '@/api/client'

/** Active project + the ingest / validate mutations every view needs. */
export function useProject() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['project', 'active'],
    queryFn: projectsApi.active,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  })

  const invalidateAll = () => qc.invalidateQueries()

  const ingest = useMutation({
    mutationFn: ({ id, force }: { id: number; force?: boolean }) => projectsApi.ingest(id, force),
    onSuccess: (stats) => {
      toast.success(`Ingested: ${stats.added} added, ${stats.updated} updated, ${stats.skipped} unchanged in ${stats.seconds}s`)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(`Ingest failed: ${e.message}`),
  })

  const validate = useMutation({
    mutationFn: (id: number) => projectsApi.validate(id),
    onSuccess: (s) => {
      const sev = s.bySeverity
      toast.success(`Validated: ${sev.error ?? 0} errors, ${sev.warning ?? 0} warnings, ${sev.info ?? 0} notes`)
      invalidateAll()
    },
    onError: (e: Error) => toast.error(`Validation failed: ${e.message}`),
  })

  return { project: query.data ?? null, isLoading: query.isLoading, missing: query.error instanceof ApiError && query.error.status === 404, ingest, validate }
}
