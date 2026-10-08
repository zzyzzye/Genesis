import { useRef, type ReactNode } from 'react'
import { useModalDialog } from './useModalDialog'
import './BlogWorkflowDialog.css'

export function BlogWorkflowDialog({ title, description, children, confirmLabel, onConfirm, onCancel, busy = false, error }: {
  title: string
  description: string
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  error?: string | null
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalDialog(cancelRef)
  return <dialog ref={dialogRef} className="blog-workflow-dialog" aria-labelledby="blog-workflow-title" aria-describedby="blog-workflow-description" aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2 id="blog-workflow-title">{title}</h2>
    <p id="blog-workflow-description">{description}</p>
    {children}
    {error && <p className="blog-workflow-dialog__error" role="alert">{error}</p>}
    <footer>
      <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>取消</button>
      <button className="blog-workflow-dialog__confirm" type="button" disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </footer>
  </dialog>
}
