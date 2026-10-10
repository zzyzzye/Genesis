import { Check, Search } from 'lucide-react'
import { useState } from 'react'

import type { AiProvider, AvailableModel } from '../../lib/api'
import { ReasoningEffortControl } from './ReasoningEffortControl'
import './AgentModelPicker.css'

const providers: AiProvider[] = ['openai', 'grok', 'gemini', 'claude', 'mimo']
const labels: Record<AiProvider, string> = { openai: 'OpenAI', grok: 'Grok', gemini: 'Gemini', claude: 'Claude', mimo: 'MiMo' }

export function AgentModelPicker({ provider, models, model, loading = false, disabled, effort, onProviderChange, onModelChange, onEffortChange }: {
  provider: AiProvider
  models: AvailableModel[]
  model: string
  loading?: boolean
  disabled: boolean
  effort: string | undefined
  onProviderChange: (provider: AiProvider) => void
  onModelChange: (model: string) => void
  onEffortChange: (effort: string | undefined) => void
}) {
  const [query, setQuery] = useState('')
  const selected = models.find((item) => item.id === model)
  const filtered = models.filter((item) => `${item.name} ${item.id}`.toLowerCase().includes(query.trim().toLowerCase()))

  return <div className="agent-picker" aria-label="模型与思考设置">
    <div className="agent-picker__providers" role="group" aria-label="选择供应商">
      {providers.map((item) => <button type="button" key={item} aria-label={`切换到 ${labels[item]} 模型`} aria-pressed={provider === item} disabled={disabled} onClick={() => { setQuery(''); onProviderChange(item) }}>{labels[item]}</button>)}
    </div>
    <label className="agent-picker__search"><Search aria-hidden="true" /><input aria-label="搜索模型" placeholder="搜索模型…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} /></label>
    <div className="agent-picker__models" aria-label={`${provider} 模型列表`} aria-busy={loading}>
      {loading ? <p role="status">正在加载模型…</p> : !models.length ? <p>当前服务商没有可用模型。</p> : !filtered.length ? <p>没有匹配的模型，试试其他名称。</p> : filtered.map((item) => <button type="button" key={item.id} title={item.name || item.id} aria-pressed={model === item.id} disabled={disabled} onClick={() => onModelChange(item.id)}>
        <span className="agent-picker__name">{item.name || item.id}</span>
        {item.context_window != null && <small>{item.context_window >= 1_000_000 ? `${Number((item.context_window / 1_000_000).toFixed(2))}M` : `${Math.round(item.context_window / 1000)}K`}</small>}
        <span className="agent-picker__check" aria-hidden="true">{model === item.id && <Check />}</span>
      </button>)}
    </div>
    <ReasoningEffortControl levels={selected?.reasoning_effort_levels ?? []} value={effort} defaultValue={selected?.reasoning_effort_default} hasModel={Boolean(selected)} disabled={disabled || loading} onChange={onEffortChange} />
  </div>
}
