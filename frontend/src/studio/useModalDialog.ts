import { useEffect, useRef, type RefObject } from 'react'

export function useModalDialog(initialFocus?: RefObject<HTMLElement | null>) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const surface = dialog.current
    if (!surface) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    surface.showModal()
    initialFocus?.current?.focus()
    if (initialFocus?.current instanceof HTMLInputElement) initialFocus.current.select()

    // 在首尾控件间循环，避免 Tab 离开应用内的模态操作。
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !surface) return
      const controls = [...surface.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    surface.addEventListener('keydown', trapFocus)
    return () => {
      surface.removeEventListener('keydown', trapFocus)
      surface.close()
      requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus() })
    }
  }, [initialFocus])
  return dialog
}
