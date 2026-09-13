import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/Modal/Modal'
import styles from './PromptDialog.module.css'

export interface PromptField {
  name: string
  label: string
  placeholder?: string
  hint?: string
  mono?: boolean
  initial?: string
  required?: boolean
  /** Return an error message to block submission. */
  validate?: (value: string, all: Record<string, string>) => string | null
}

interface Props {
  title: string
  fields: PromptField[]
  submitLabel?: string
  busy?: boolean
  onSubmit: (values: Record<string, string>) => void
  onClose: () => void
  /** Optional line under the fields, e.g. what the entry will look like. */
  preview?: (values: Record<string, string>) => string | null
}

/** Small form in a modal - the replacement for window.prompt(): one or more labelled inputs, Enter submits. */
export function PromptDialog({ title, fields, submitLabel = 'Add', busy, onSubmit, onClose, preview }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])))
  const errors = Object.fromEntries(fields.map((f) => {
    const v = values[f.name] ?? ''
    if (f.required && !v.trim()) return [f.name, 'required']
    return [f.name, f.validate ? f.validate(v, values) : null]
  }))
  const blocked = busy || fields.some((f) => errors[f.name])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!blocked) onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])))
  }
  const line = preview?.(values)
  const footer = (
    <>
      <span className={styles.spacer} />
      <button type="button" className="btn sm" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="submit" form="prompt-dialog-form" className="btn sm primary" disabled={blocked}>{submitLabel}</button>
    </>
  )
  return (
    <Modal title={title} onClose={onClose} footer={footer} width={440}>
      <form id="prompt-dialog-form" className={styles.form} onSubmit={submit}>
        {fields.map((f, i) => {
          const err = errors[f.name]
          const touched = (values[f.name] ?? '') !== (f.initial ?? '')
          return (
            <label key={f.name} className={styles.field}>
              <span className={styles.label}>{f.label}</span>
              <input value={values[f.name]} autoFocus={i === 0} spellCheck={false} placeholder={f.placeholder} data-mono={f.mono || undefined}
                     aria-invalid={touched && !!err} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
              {touched && err && err !== 'required' ? <span className={styles.err}>{err}</span> : f.hint ? <span className={styles.hint}>{f.hint}</span> : null}
            </label>
          )
        })}
        {line && <pre className={styles.preview}>{line}</pre>}
      </form>
    </Modal>
  )
}
