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
  return <div className="agent-reasoning">
    <span className="agent-reasoning__title">思考强度</span>
    <div className="agent-reasoning__options" role="group" aria-label="思考强度">
      {[undefined, ...levels].map((level) => <button
        className="agent-reasoning__option"
        type="button"
        key={level ?? 'default'}
        aria-pressed={value === level}
        disabled={disabled || !hasModel}
        onClick={() => onChange(level)}
      >{reasoningEffortLabel(level)}<span className="agent-reasoning__check" aria-hidden="true">{value === level ? '✓' : ''}</span></button>)}
    </div>
    {!hasModel ? <p>选择模型后可设置思考强度。</p>
      : levels.length === 0 ? <p>当前模型暂无可选档位，沿用默认设置。</p>
        : defaultValue ? <p>默认沿用模型设置（{reasoningEffortLabel(defaultValue)}）。</p> : null}
  </div>
}
