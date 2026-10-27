import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { AvailableModel, TokenPriceTier } from '../../lib/api'
import { modelDisplayName } from './modelDisplayName'
import './ModelPriceTooltip.css'

const rows: { field: keyof Pick<TokenPriceTier, 'input' | 'output' | 'cache_read' | 'cache_write' | 'cache_write_1h'>; label: string }[] = [
  { field: 'input', label: '输入' }, { field: 'output', label: '输出' },
  { field: 'cache_read', label: '缓存读取' }, { field: 'cache_write', label: '缓存写入 · 5 分钟' },
  { field: 'cache_write_1h', label: '缓存写入 · 1 小时' },
]
const tierNames: Record<string, string> = { short: '短上下文', long: '长上下文', base: '标准', standard: '标准', free: '免费' }

/** 价格只作只读提示；使用浏览器顶层，避免被模型列表和助手裁切。 */
export function ModelPriceTooltip({ id, model, trigger, onDismiss, onEnter, onLeave }: {
  id: string
  model: AvailableModel
  trigger: HTMLButtonElement
  onDismiss: () => void
  onEnter: () => void
  onLeave: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  const pricing = model.pricing
  const native = typeof HTMLElement.prototype.showPopover === 'function'
  useLayoutEffect(() => {
    const surface = panel.current!
    const theme = getComputedStyle(trigger)
    for (const token of ['--reasoning-text', '--reasoning-muted', '--reasoning-hover', '--assistant-paper', '--assistant-surface']) {
      surface.style.setProperty(token, theme.getPropertyValue(token))
    }
    if (native) surface.showPopover()
    const anchor = trigger.getBoundingClientRect()
    const bounds = surface.getBoundingClientRect()
    const width = document.documentElement.clientWidth || window.innerWidth
    const height = window.innerHeight
    const left = anchor.left - bounds.width - 8
    const right = anchor.right + 8
    const beside = left >= 8 || right + bounds.width <= width - 8
    surface.style.left = `${Math.max(8, Math.min(left >= 8 ? left : beside ? right : anchor.left, width - bounds.width - 8))}px`
    surface.style.top = `${Math.max(8, Math.min(beside ? anchor.top : anchor.top >= bounds.height + 8 ? anchor.top - bounds.height - 8 : anchor.bottom + 8, height - bounds.height - 8))}px`
    surface.style.visibility = 'visible'
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onDismiss()
      }
    }
    function dismiss(event: Event) {
      if (event.target instanceof Node && (surface.contains(event.target) || trigger.contains(event.target))) return
      onDismiss()
    }
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', dismiss, true)
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', onDismiss)
    return () => {
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', dismiss, true)
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', onDismiss)
      if (native && surface.matches(':popover-open')) surface.hidePopover()
    }
  }, [native, onDismiss, trigger, model])

  const available = pricing?.status === 'available' || pricing?.status === 'free'
  const symbol = pricing?.currency === 'USD' ? '$' : '¥'
  return createPortal(<div ref={panel} id={id} className="model-price-tooltip" popover={native ? 'manual' : undefined} role="tooltip" onPointerEnter={onEnter} onPointerLeave={onLeave}>
    <strong>{modelDisplayName(model.name || model.id)}</strong>
    {pricing?.group && <p className="model-price-tooltip__group">{pricing.group}{pricing.group_ratio != null && <span> · {pricing.group_ratio} 倍</span>}</p>}
    {available && pricing.tiers.length ? <>
      <p className="model-price-tooltip__unit">{pricing.currency === 'USD' ? '美元' : '人民币'} / 100 万 Token</p>
      <table><caption>模型输入输出价格</caption><thead><tr><th>项目</th>{pricing.tiers.map((tier, index) => <th key={index}>{tierNames[tier.name] ?? tier.name}</th>)}</tr></thead>
        <tbody>{rows.filter(row => pricing.tiers.some(tier => tier[row.field] != null)).map(row => <tr key={row.field}><th scope="row">{row.label}</th>{pricing.tiers.map((tier, index) => <td key={index}>{tier[row.field] != null ? `${symbol}${tier[row.field]}` : '未提供'}</td>)}</tr>)}</tbody>
      </table>
      {pricing.tiers.some(tier => tier.condition) && <div className="model-price-tooltip__conditions">{pricing.tiers.map((tier, index) => tier.condition && <p key={index}>{tierNames[tier.name] ?? tier.name}：{tier.condition}</p>)}</div>}
    </> : <p className="model-price-tooltip__unknown">{pricing?.note || '暂未取得该模型的分组价格，请稍后刷新模型列表。'}</p>}
    {available && <p className="model-price-tooltip__note">{pricing.note}</p>}
  </div>, document.body)
}
