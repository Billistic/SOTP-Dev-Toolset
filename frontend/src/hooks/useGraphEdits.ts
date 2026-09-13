import { useMutation, useQueryClient } from '@tanstack/react-query'
import { entitiesApi } from '@/api/entities'
import { toast } from '@/store/useToastStore'
import { useUndoStore } from '@/store/useUndoStore'
import type { EditChange } from '@/types/api'

const PREREQ_RE = /^Prerequisites\.ResearchPrerequisite(?:\[(\d+)\])?\.Subject$/

/**
 * Graph gestures translated into entity edits, each recorded on the undo stack with its inverse.
 * A connection from a node's port (its path, e.g. ``ability:2``) to another node writes that node's
 * name into the field; disconnecting clears it.  Research prerequisites are blocks, so they are
 * inserted / removed rather than set.
 */
export function useGraphEdits() {
  const qc = useQueryClient()
  const push = useUndoStore((s) => s.push)
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

  // ── primitives (no undo bookkeeping) ────────────────────────────────
  const setField = (name: string, path: string, value: unknown, message?: string) =>
    edit.mutateAsync({ name, changes: [{ op: 'set', path, value }], message })
  const addPrereq = (source: string, target: string, level = 1, message?: string) =>
    edit.mutateAsync({
      name: source, message,
      changes: [{ op: 'insertText', parent: 'Prerequisites', text: `ResearchPrerequisite\n\tSubject "${target}"\n\tLevel ${level}\n`,
                  afterLast: ['ResearchPrerequisite', 'NumResearchPrerequisites'] }],
    })
  /** Remove the prerequisite block pointing at ``target`` (looked up fresh, so it survives re-ordering by an undo). */
  const removePrereq = async (source: string, target: string, message?: string) => {
    const detail = await entitiesApi.get(source)
    const idx = detail.prerequisites.map((p) => p.subject).lastIndexOf(target)
    if (idx < 0) throw new Error(`${source} has no prerequisite ${target}`)
    return edit.mutateAsync({ name: source, changes: [{ op: 'remove', path: idx ? `Prerequisites.ResearchPrerequisite[${idx}]` : 'Prerequisites.ResearchPrerequisite' }], message })
  }

  // ── gestures ────────────────────────────────────────────────────────
  /** Point ``source``'s field at ``target``; ``prev`` is what the field held (``''`` for a free port). */
  const connect = async (source: string, port: string, target: string, prev: string | null = '') => {
    if (port === 'prerequisite') {
      await addPrereq(source, target, 1, `${source} now requires ${target}`)
      push({ label: `${source} requires ${target}`, undo: () => removePrereq(source, target), redo: () => addPrereq(source, target) })
      return
    }
    await setField(source, port, target, `${source}.${port} → ${target}`)
    push({ label: `${source}.${port} → ${target}`, undo: () => setField(source, port, prev ?? ''), redo: () => setField(source, port, target) })
  }

  /** Clear the field behind an edge; prerequisite blocks are removed outright (``edge`` lets undo restore them). */
  const disconnect = async (source: string, port: string, edge?: { target: string; level?: number | null }) => {
    const m = PREREQ_RE.exec(port)
    if (m) {
      const target = edge?.target
      if (!target) { await edit.mutateAsync({ name: source, changes: [{ op: 'remove', path: m[1] === undefined ? 'Prerequisites.ResearchPrerequisite' : `Prerequisites.ResearchPrerequisite[${m[1]}]` }], message: `Removed prerequisite from ${source}` }); return }
      await removePrereq(source, target, `${source} no longer requires ${target}`)
      push({ label: `remove ${target} from ${source}`, undo: () => addPrereq(source, target, edge?.level ?? 1), redo: () => removePrereq(source, target) })
      return
    }
    await setField(source, port, '', `Cleared ${source}.${port}`)
    push({ label: `clear ${source}.${port}`, undo: () => setField(source, port, edge?.target ?? ''), redo: () => setField(source, port, '') })
  }

  /** Research screen placement: ``researchWindowLocation.pos [ x, y ]``. */
  const placeResearch = async (name: string, x: number, y: number, prev?: { x: number; y: number }) => {
    await setField(name, 'researchWindowLocation.pos', [x, y], `${name} moved to [${x}, ${y}]`)
    if (prev) push({ label: `move ${name} to [${x}, ${y}]`, undo: () => setField(name, 'researchWindowLocation.pos', [prev.x, prev.y]), redo: () => setField(name, 'researchWindowLocation.pos', [x, y]) })
  }

  /** Move a research subject to another tier (the lab-count requirement column). */
  const setTier = async (name: string, tier: number, prevTier?: number) => {
    await setField(name, 'Tier', tier, `${name} is now tier ${tier}`)
    if (prevTier !== undefined) push({ label: `${name} → tier ${tier}`, undo: () => setField(name, 'Tier', prevTier), redo: () => setField(name, 'Tier', tier) })
  }

  return { connect, disconnect, placeResearch, setTier, busy: edit.isPending }
}
