import { useEffect, useMemo, useRef, useState } from 'react'
import { useEntity, useEntityText } from '@/hooks/useEntity'
import type { Diagnostic } from '@/types/api'
import styles from './RawEditor.module.css'

interface Props {
  name: string
  diagnostics: Diagnostic[]
}

/** Plain-text view of the file with a line-number gutter and diagnostic markers. */
export function RawEditor({ name, diagnostics }: Props) {
  const [mode, setMode] = useState<'preserve' | 'pretty'>('preserve')
  const { data: text, isLoading } = useEntityText(name, mode)
  const { putText } = useEntity(name)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const gutterRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (text !== undefined && !editing) setDraft(text) }, [text, editing])

  const lines = useMemo(() => draft.split('\n'), [draft])
  const marks = useMemo(() => {
    const m = new Map<number, Diagnostic[]>()
    for (const d of diagnostics) if (d.line) m.set(d.line, [...(m.get(d.line) ?? []), d])
    return m
  }, [diagnostics])

  const syncScroll = () => { if (gutterRef.current && areaRef.current) gutterRef.current.scrollTop = areaRef.current.scrollTop }
  const dirty = text !== undefined && draft !== text

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.modes}>
          <button className={styles.modeBtn} data-active={mode === 'preserve' || undefined} onClick={() => setMode('preserve')} title="Bytes as they will be written">preserve</button>
          <button className={styles.modeBtn} data-active={mode === 'pretty' || undefined} onClick={() => setMode('pretty')} title="Re-indented from the parsed structure">pretty</button>
        </div>
        <span className="muted">{lines.length} lines{dirty ? ' · edited' : ''}</span>
        <span className={styles.spacer} />
        <button className="btn sm" disabled={!dirty} onClick={() => { setDraft(text ?? ''); setEditing(false) }}>Discard</button>
        <button className="btn sm primary" disabled={!dirty || putText.isPending} onClick={() => putText.mutate(draft, { onSuccess: () => setEditing(false) })}>Apply text</button>
      </div>
      {isLoading ? <p className={styles.hint}>Loading…</p> : (
        <div className={styles.editor}>
          <div className={styles.gutter} ref={gutterRef} aria-hidden>
            {lines.map((_, i) => {
              const ds = marks.get(i + 1)
              const worst = ds?.some((d) => d.severity === 'error') ? 'error' : ds?.some((d) => d.severity === 'warning') ? 'warning' : ds ? 'info' : undefined
              return <div key={i} className={styles.lineNo} data-sev={worst} title={ds?.map((d) => `${d.code}: ${d.message}`).join('\n')}>{i + 1}</div>
            })}
          </div>
          <textarea ref={areaRef} className={styles.area} value={draft} spellCheck={false} wrap="off"
                    onChange={(e) => { setDraft(e.target.value); setEditing(true) }} onScroll={syncScroll} />
        </div>
      )}
    </div>
  )
}
