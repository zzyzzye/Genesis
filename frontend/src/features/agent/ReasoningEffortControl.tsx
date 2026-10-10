import { RotateCcw, Zap } from 'lucide-react'
import type { CSSProperties } from 'react'

import './ReasoningEffortControl.css'
import { reasoningEffortLabel } from './useReasoningEffort'

export function ReasoningEffortControl({ levels, value, defaultValue, modelName, hasModel, disabled, onChange }: {
  levels: string[]
  value: string | undefined
  defaultValue?: string | null
  modelName?: string
  hasModel: boolean
  disabled: boolean
  onChange: (value: string | undefined) => void
}) {
  const options = levels.length ? [undefined, ...levels] : [undefined]
  const index = Math.max(0, options.indexOf(value))
  const unavailable = disabled || !hasModel || !levels.length
  const label = reasoningEffortLabel(options[index])
  const description = !hasModel ? '选择模型后可设置思考强度。'
    : !levels.length ? '当前模型暂无可选档位，沿用默认设置。'
      : !value && defaultValue ? `沿用模型设置（${reasoningEffortLabel(defaultValue)}）` : undefined

  return <div className="agent-reasoning">
    <div className="agent-reasoning__header">
      <Zap className="agent-reasoning__icon" aria-hidden="true" />
      <div className="agent-reasoning__selection">
        <span className="agent-reasoning__value" aria-live="polite">{label}</span>
        <span className="agent-reasoning__model" title={modelName}>{modelName || '思考强度'}</span>
      </div>
      <button className="agent-reasoning__reset" type="button" aria-label="恢复默认思考强度" title="恢复默认思考强度" disabled={unavailable || value === undefined} onClick={() => onChange(undefined)}>
        <RotateCcw aria-hidden="true" />
      </button>
    </div>
    <div className="agent-reasoning__slider" style={{ '--reasoning-fraction': index / Math.max(1, options.length - 1) } as CSSProperties}>
      <div className="agent-reasoning__track" aria-hidden="true">
        <span className="agent-reasoning__fill" />
        <div className="agent-reasoning__ticks">{options.map((level) => <span key={level ?? 'default'} />)}</div>
      </div>
      <input type="range" aria-label="思考强度" aria-valuetext={label} min={0} max={Math.max(1, options.length - 1)} step={1} value={index} disabled={unavailable} onChange={(event) => onChange(options[Number(event.currentTarget.value)])} />
    </div>
    {description && <p>{description}</p>}
  </div>
}
