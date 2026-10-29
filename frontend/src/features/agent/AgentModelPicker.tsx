import { Check, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import type { AiProvider, AvailableModel, ThinkingMode } from '../../lib/api'
import { ReasoningEffortControl } from './ReasoningEffortControl'
import { modelDisplayName } from './modelDisplayName'
import { ModelPriceTooltip } from './ModelPriceTooltip'
import './AgentModelPicker.css'

const providers: AiProvider[] = ['openai', 'grok', 'gemini', 'claude', 'mimo']
const labels: Record<AiProvider, string> = { openai: 'OpenAI', grok: 'Grok', gemini: 'Gemini', claude: 'Claude', mimo: 'MiMo' }

export function AgentModelPicker({ provider, models, model, loading = false, error = '', disabled, effort, thinkingMode, onThinkingModeChange, onProviderChange, onModelChange, onEffortChange, onRefresh }: {
  provider: AiProvider
  models: AvailableModel[]
  model: string
  loading?: boolean
  error?: string
  disabled: boolean
  effort: string | undefined
  thinkingMode?: ThinkingMode
  onThinkingModeChange?: (mode: ThinkingMode | undefined) => void
  onProviderChange: (provider: AiProvider) => void
  onModelChange: (model: string) => void
  onEffortChange: (effort: string | undefined) => void
  onRefresh?: () => void
}) {
  const [query, setQuery] = useState('')
  const [preview, setPreview] = useState<{ model: AvailableModel; trigger: HTMLButtonElement } | null>(null)
  const previewId = useId()
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }, [])
  const closePreview = useCallback(() => { cancelClose(); setPreview(null) }, [cancelClose])
  const scheduleClose = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setPreview(null), 140)
  }, [cancelClose])
  useEffect(() => () => cancelClose(), [cancelClose])
  const showPrice = (item: AvailableModel, trigger: HTMLButtonElement) => {
    cancelClose()
    setPreview({ model: item, trigger })
  }
  const selected = models.find((item) => item.id === model)
  const filtered = models.filter((item) => `${modelDisplayName(item.name || item.id)} ${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const previewModel = filtered.find(item => item.id === preview?.model.id)

  return <div className="agent-picker" aria-label="模型与思考设置">
    <div className="agent-picker__providers" role="group" aria-label="选择供应商">
      {providers.map((item) => <button type="button" key={item} aria-label={`切换到 ${labels[item]} 模型`} aria-pressed={provider === item} disabled={disabled} onClick={() => { closePreview(); setQuery(''); onProviderChange(item) }}>{labels[item]}</button>)}
    </div>
    <div className="agent-picker__search-row"><label className="agent-picker__search"><Search aria-hidden="true" /><input aria-label="搜索模型" placeholder="搜索模型…" value={query} onChange={(event) => { closePreview(); setQuery(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>{onRefresh && <button className="agent-picker__refresh" type="button" aria-label="刷新模型与价格" title="刷新模型与价格" disabled={disabled || loading} onClick={() => { closePreview(); onRefresh() }}><RefreshCw size={13} aria-hidden="true" /></button>}</div>
    <div className="agent-picker__models" aria-label={`${provider} 模型列表`} aria-busy={loading}>
      {error && <p role="alert">{error} 切换供应商或重新打开助手可重试。</p>}
      {!models.length && error ? null : !models.length && loading ? <p role="status">正在加载模型…</p> : !models.length ? <p>当前服务商没有可用模型。</p> : !filtered.length ? <p>没有匹配的模型，试试其他名称。</p> : filtered.map((item) => <button type="button" key={item.id} aria-describedby={preview?.model.id === item.id ? previewId : undefined} aria-pressed={model === item.id} disabled={disabled} onPointerEnter={event => { if (event.pointerType !== 'touch') showPrice(item, event.currentTarget) }} onPointerLeave={scheduleClose} onFocus={event => showPrice(item, event.currentTarget)} onBlur={closePreview} onClick={() => onModelChange(item.id)}>
        <span className="agent-picker__name">{modelDisplayName(item.name || item.id)}</span>
        <span className="agent-picker__check" aria-hidden="true">{model === item.id && <Check />}</span>
      </button>)}
    </div>
    {preview && previewModel && !loading && !error && <ModelPriceTooltip id={previewId} model={previewModel} trigger={preview.trigger} onDismiss={closePreview} onEnter={cancelClose} onLeave={scheduleClose} />}
    {Boolean(selected?.thinking_modes?.length) && <div className="agent-reasoning">
      <span className="agent-reasoning__title">思考模式</span>
      <select aria-label="思考模式" value={thinkingMode ?? ''} disabled={disabled || loading} onChange={(event) => onThinkingModeChange?.(event.target.value === 'enabled' ? 'enabled' : event.target.value === 'disabled' ? 'disabled' : undefined)}>
        <option value="">默认</option>
        {selected?.thinking_modes?.includes('enabled') && <option value="enabled">开启</option>}
        {selected?.thinking_modes?.includes('disabled') && <option value="disabled">关闭</option>}
      </select>
    </div>}
    {(!selected?.thinking_modes?.length || Boolean(selected?.reasoning_effort_levels?.length)) && <ReasoningEffortControl levels={selected?.reasoning_effort_levels ?? []} value={effort} defaultValue={selected?.reasoning_effort_default} hasModel={Boolean(selected)} disabled={disabled || loading || thinkingMode === 'disabled'} onChange={onEffortChange} />}
  </div>
}
