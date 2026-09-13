import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { entitiesApi } from '@/api/entities'
import type { EditChange, EntityDetail } from '@/types/api'
import { toast } from '@/store/useToastStore'
import { useStringEditorStore } from '@/store/useStringEditorStore'
import { useUiStore, tabId } from '@/store/useUiStore'

/** Detail query + the edit / revert / write mutations for one entity. */
export function useEntity(name: string) {
  const qc = useQueryClient()
  const key = ['entity', name]
  const query = useQuery({ queryKey: key, queryFn: () => entitiesApi.get(name) })

  const refresh = (detail: EntityDetail) => {
    qc.setQueryData(key, detail)
    qc.invalidateQueries({ queryKey: ['entities'] })
    qc.invalidateQueries({ queryKey: ['diagnostics'] })
    qc.invalidateQueries({ queryKey: ['entity', name, 'text'] })
    qc.invalidateQueries({ queryKey: ['entity', name, 'references'] })
    qc.invalidateQueries({ queryKey: ['entity', name, 'peers'] })
    qc.invalidateQueries({ queryKey: ['entity', name, 'layout'] })
    qc.invalidateQueries({ queryKey: ['entity', name, 'buffs'] })
  }

  const edit = useMutation({
    mutationFn: (changes: EditChange[]) => entitiesApi.edit(name, changes),
    onSuccess: (d) => {
      refresh(d)
      const created = d.createdStrings ?? []
      if (created.length) {
        qc.invalidateQueries({ queryKey: ['strings'] })
        for (const s of created) qc.invalidateQueries({ queryKey: ['string', s.stringId] })
        toast.info(`Created string ${created.map((s) => s.stringId).join(', ')} in English.str`)
        useStringEditorStore.getState().open(created[0].stringId, true)
      }
    },
    onError: (e: Error) => toast.error(`Edit failed: ${e.message}`),
  })
  const putText = useMutation({
    mutationFn: (text: string) => entitiesApi.putText(name, text),
    onSuccess: (d) => { refresh(d); toast.success('Text applied') },
    onError: (e: Error) => toast.error(`Could not apply text: ${e.message}`),
  })
  const revert = useMutation({
    mutationFn: () => entitiesApi.revert(name),
    onSuccess: (d) => { refresh(d); toast.info('Reverted to file on disk') },
    onError: (e: Error) => toast.error(e.message),
  })
  const write = useMutation({
    mutationFn: (mode: 'preserve' | 'pretty' = 'preserve') => entitiesApi.write(name, mode),
    onSuccess: (r) => {
      toast.success(`Written ${r.written}`)
      qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['entities'] })
      qc.invalidateQueries({ queryKey: ['diagnostics'] }); qc.invalidateQueries({ queryKey: ['manifest'] })   // a first write adds a manifest line
    },
    onError: (e: Error) => toast.error(`Write failed: ${e.message}`),
  })

  const remove = useMutation({
    mutationFn: () => entitiesApi.remove(name, true),
    onSuccess: (r) => {
      useUiStore.getState().closeTab(tabId({ kind: 'entity', name }))
      qc.removeQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['entities'] })
      qc.invalidateQueries({ queryKey: ['diagnostics'] })
      toast.success(r.movedTo ? `Deleted ${name}; file moved to .sotp-trash` : `Deleted ${name}`)
    },
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  })

  const setManifest = useMutation({
    mutationFn: (listed: boolean) => entitiesApi.setManifest(name, listed),
    onSuccess: (r) => {
      refresh(r.entity)
      qc.invalidateQueries({ queryKey: ['manifest'] })
      toast[r.changed ? 'success' : 'info'](r.listed ? (r.changed ? `${name} added to entity.manifest` : 'Already listed') : (r.changed ? `${name} removed from entity.manifest` : 'Was not listed'))
    },
    onError: (e: Error) => toast.error(`Manifest update failed: ${e.message}`),
  })

  return { entity: query.data, isLoading: query.isLoading, error: query.error as Error | null, edit, putText, revert, write, remove, setManifest }
}

export function useEntityText(name: string, mode: 'preserve' | 'pretty') {
  return useQuery({ queryKey: ['entity', name, 'text', mode], queryFn: () => entitiesApi.text(name, mode) })
}
