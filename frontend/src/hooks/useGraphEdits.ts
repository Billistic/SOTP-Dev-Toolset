import { useMutation, useQueryClient } from '@tanstack/react-query'
import { entitiesApi } from '@/api/entities'
import { toast } from '@/store/useToastStore'
import type { EditChange } from '@/types/api'

const PREREQ_RE = /^Prerequisites\.ResearchPrerequisite(?:\[(\d+)\])?\.Subject$/

/**
 * Graph gestures translated into entity edits.  A connection from a node's port
 * (its path, e.g. ``ability:2``) to another node writes that node's name into the
 * field; disconnecting clears it.  Research prerequisites are blocks, so they are
 * inserted / removed rather than set.
 */
export function useGraphEdits() {
  const qc = useQueryClient()
  const invalidate = (name: string) => {
    qc.invalidateQueries({ queryKey: ['entity', name] })
    qc.invalidateQueries({ queryKey: ['entities'] })
    qc.invalidateQueries({ queryKey: ['graph'] })
    qc.invalidateQueries({ queryKey: ['diagnostics'] })
  }
  const edit = useMutation({
    mutationFn: ({ name, changes }: { name: string; changes: EditChange[]; message?: string }) => entitiesApi.edit(name, changes),
    onSuccess: (_d, v) => { invalidate(v.name); if (v.message) toast.success(v.message) },
    onError: (e: Error) => toast.error(`Edit failed: ${e.message}`),
  })

  /** Point ``source``'s field at ``target``. ``port`` is the field path; ``'prerequisite'`` adds a new research prerequisite. */
  const connect = (source: string, port: string, target: string) => {
    if (port === 'prerequisite') {
      return edit.mutate({
        name: source, message: `${source} now requires ${target}`,
        changes: [{ op: 'insertText', parent: 'Prerequisites', text: `ResearchPrerequisite\n\tSubject "${target}"\n\tLevel 1\n`,
                    afterLast: ['ResearchPrerequisite', 'NumResearchPrerequisites'] }],
      })
    }
    edit.mutate({ name: source, changes: [{ op: 'set', path: port, value: target }], message: `${source}.${port} → ${target}` })
  }

  /** Clear the field behind an edge (prerequisite blocks are removed outright). */
  const disconnect = (source: string, port: string) => {
    const m = PREREQ_RE.exec(port)
    if (m) {
      const block = m[1] === undefined ? 'Prerequisites.ResearchPrerequisite' : `Prerequisites.ResearchPrerequisite[${m[1]}]`
      return edit.mutate({ name: source, changes: [{ op: 'remove', path: block }], message: `Removed prerequisite from ${source}` })
    }
    edit.mutate({ name: source, changes: [{ op: 'set', path: port, value: '' }], message: `Cleared ${source}.${port}` })
  }

  /** Research screen placement: ``researchWindowLocation.pos [ x, y ]``. */
  const placeResearch = (name: string, x: number, y: number) =>
    edit.mutate({ name, changes: [{ op: 'set', path: 'researchWindowLocation.pos', value: [x, y] }], message: `${name} moved to [${x}, ${y}]` })

  /** Move a research subject to another tier (the lab-count requirement column). */
  const setTier = (name: string, tier: number) =>
    edit.mutate({ name, changes: [{ op: 'set', path: 'Tier', value: tier }], message: `${name} is now tier ${tier}` })

  return { connect, disconnect, placeResearch, setTier, busy: edit.isPending }
}
