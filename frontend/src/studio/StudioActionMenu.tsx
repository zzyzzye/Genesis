import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import './StudioActionMenu.css'

/** 行操作共用浏览器顶层弹出层，避免被工作区滚动容器裁切。 */
export function StudioActionMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback((restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) trigger?.focus({ preventScroll: true })
  }, [trigger])
  return <>
    <button ref={setTrigger} className="studio-action-menu__trigger" type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}><MoreHorizontal aria-hidden="true" size={18} /></button>
    {open && trigger && <ActionPanel label={label} trigger={trigger} onClose={close}>{children(() => close(true))}</ActionPanel>}
  </>
}

function ActionPanel({ label, trigger, onClose, children }: { label: string; trigger: HTMLButtonElement; onClose: (restoreFocus?: boolean) => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const native = typeof HTMLElement.prototype.showPopover === 'function'
  useLayoutEffect(() => {
    const surface = panel.current!
    // Portal 不继承工作区主题，打开时同步必要令牌，不逐帧读取样式。
    const theme = getComputedStyle(trigger)
    for (const token of ['--studio-soft', '--studio-ink', '--studio-hover', '--studio-muted', '--studio-ui']) {
      surface.style.setProperty(token, theme.getPropertyValue(token))
    }
    if (native) surface.showPopover()
    const anchor = trigger.getBoundingClientRect()
    const bounds = surface.getBoundingClientRect()
    const width = document.documentElement.clientWidth || window.innerWidth
    const height = window.innerHeight
    surface.style.left = `${Math.max(8, Math.min(anchor.right - bounds.width, width - bounds.width - 8))}px`
    surface.style.top = `${Math.max(8, Math.min(anchor.bottom + 6 + bounds.height <= height - 8 ? anchor.bottom + 6 : anchor.top - bounds.height - 6, height - bounds.height - 8))}px`
    surface.style.visibility = 'visible'
    surface.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    function dismiss(event: Event) {
      if (event.target instanceof Node && (surface.contains(event.target) || trigger.contains(event.target))) return
      onClose()
    }
    window.addEventListener('resize', dismiss)
    document.addEventListener('scroll', dismiss, true)
    document.addEventListener('pointerdown', dismiss)
    return () => {
      window.removeEventListener('resize', dismiss)
      document.removeEventListener('scroll', dismiss, true)
      document.removeEventListener('pointerdown', dismiss)
    }
  }, [native, onClose, trigger])
  return createPortal(<div ref={panel} className="studio-action-menu" popover={native ? 'auto' : undefined} role="menu" aria-label={label} onToggle={event => { if (event.newState === 'closed') onClose() }} onKeyDown={event => {
    if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); onClose(true); return }
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null
    if (next !== null) { event.preventDefault(); items[next]?.focus() }
  }}>{children}</div>, document.body)
}
