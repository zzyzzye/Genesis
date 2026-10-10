import './ReasoningEffortControl.css'
import { reasoningEffortLabel } from './useReasoningEffort'

export function ReasoningEffortControl({ levels, value, defaultValue, hasModel, disabled, onChange }: {
  levels: string[]
  value: string | undefined
  defaultValue?: string | null
  hasModel: boolean
  disabled: boolean
  onChange: (value: string | undefined) => void
}) {
  const available = hasModel && levels.length > 0
  return <div className="agent-reasoning">
    <span className="agent-reasoning__title">思考强度</span>
    {available ? <select aria-label="思考强度" value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">默认{defaultValue ? `（${reasoningEffortLabel(defaultValue)}）` : ''}</option>
      {levels.map((level) => <option key={level} value={level}>{reasoningEffortLabel(level)}</option>)}
    </select> : <span className="agent-reasoning__unavailable">{hasModel ? '使用模型默认设置' : '请先选择模型'}</span>}
  </div>
}
