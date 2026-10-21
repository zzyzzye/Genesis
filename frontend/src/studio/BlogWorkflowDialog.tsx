import { useId, useRef, type ReactNode, type RefObject } from 'react'
import { useModalDialog } from './useModalDialog'
import './BlogWorkflowDialog.css'

export function BlogWorkflowDialog({ title, description, children, confirmLabel, onConfirm, onCancel, busy = false, confirmDisabled = false, error, returnFocus, className = '', cancelLabel = '取消' }: {
  title: string
  description: string
  children?: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
  confirmDisabled?: boolean
  error?: string | null
  returnFocus?: RefObject<HTMLElement | null>
  className?: string
  cancelLabel?: string
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const dialogRef = useModalDialog(cancelRef, returnFocus)
  return <dialog ref={dialogRef} className={`blog-workflow-dialog ${className}`} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <h2 id={`${id}-title`}>{title}</h2>
    <p id={`${id}-description`}>{description}</p>
    {children}
    {error && <p className="blog-workflow-dialog__error" role="alert">{error}</p>}
    <footer>
      <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
      <button className="blog-workflow-dialog__confirm" type="button" disabled={busy || confirmDisabled} onClick={onConfirm}>{confirmLabel}</button>
    </footer>
  </dialog>
}
