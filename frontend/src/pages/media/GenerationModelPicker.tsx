import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { ModelPriceTooltip } from '../../features/agent/ModelPriceTooltip'
import type { VideoModel } from './VideoGeneration'
import './GenerationModelPicker.css'

/** 图片与视频共用模型入口，简介和价格复用助手的顶层浮层。 */
export function GenerationModelPicker({ models, value, disabled, label, placeholder, onChange }: {
  models: VideoModel[]
  value: string
  disabled: boolean
  label: string
  placeholder: string
  onChange: (id: string) => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<{ model: VideoModel; trigger: HTMLElement } | null>(null)
  const id = useId()
  const native = typeof HTMLElement.prototype.showPopover === 'function'
  const cancelClose = useCallback(() => { if (timer.current !== null) clearTimeout(timer.current); timer.current = null }, [])
  const closePreview = useCallback(() => { cancelClose(); setPreview(null) }, [cancelClose])
  const leave = () => { cancelClose(); timer.current = setTimeout(() => setPreview(null), 140) }
  const show = (model: VideoModel, element: HTMLElement) => { cancelClose(); setPreview({ model, trigger: element }) }
  const selected = models.find(model => model.id === value)
  const filtered = models.filter(model => model.id.toLowerCase().includes(query.trim().toLowerCase()))
  const close = useCallback((restore = false) => {
    menu.current?.hidePopover?.()
    setOpen(false)
    if (restore) trigger.current?.focus()
    closePreview()
  }, [closePreview])
  useEffect(() => () => cancelClose(), [cancelClose])
  if (disabled && open) setOpen(false)
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return
    const surface = menu.current
    surface.showPopover?.()
    const anchor = trigger.current.getBoundingClientRect()
    const bounds = surface.getBoundingClientRect()
    surface.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - bounds.width - 12))}px`
    surface.style.top = `${Math.max(12, Math.min(anchor.top - bounds.height - 8, window.innerHeight - bounds.height - 12))}px`
    search.current?.focus()
    const resize = () => close()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [open, close])
  return <div className="media-generation-model-picker">
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-describedby={preview && !open ? `${id}-preview` : undefined} disabled={disabled} onPointerEnter={event => { if (selected && event.pointerType !== 'touch') show(selected, event.currentTarget) }} onPointerLeave={leave} onFocus={event => { if (selected && !open) show(selected, event.currentTarget) }} onBlur={closePreview} onClick={() => { closePreview(); setQuery(''); setOpen(!open) }}>
      <span>{selected?.id ?? placeholder}</span><ChevronDown size={12} aria-hidden="true" />
    </button>
    {open && <div ref={menu} data-model-menu="generation" popover={native ? 'auto' : undefined} className="media-generation-model-menu nodrag nowheel nopan" onToggle={event => { if (event.newState === 'closed') { setOpen(false); closePreview() } }} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')]
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
        items[next]?.focus()
      }
    }}>
      <input ref={search} aria-label="搜索生成模型" placeholder="搜索模型…" value={query} onChange={event => { closePreview(); setQuery(event.target.value) }} />
      {selected && <button className="media-generation-model-info" type="button" onClick={event => show(selected, event.currentTarget)}>查看当前模型说明与价格</button>}
      <div id={`${id}-list`} role="listbox" aria-label={label}>
        {filtered.map(model => <button type="button" role="option" aria-selected={value === model.id} aria-describedby={preview?.model.id === model.id ? `${id}-preview` : undefined} key={model.id} onPointerEnter={event => { if (event.pointerType !== 'touch') show(model, event.currentTarget) }} onPointerLeave={leave} onFocus={event => show(model, event.currentTarget)} onBlur={closePreview} onClick={() => { onChange(model.id); close(true) }}><span>{model.id}</span>{value === model.id && <Check size={13} aria-hidden="true" />}</button>)}
      </div>
      {!filtered.length && <p>没有匹配的模型</p>}
    </div>}
    {preview && <ModelPriceTooltip id={`${id}-preview`} model={{ ...preview.model, description: preview.model.description ?? '' }} trigger={preview.trigger} onDismiss={closePreview} onEnter={cancelClose} onLeave={leave} />}
  </div>
}
