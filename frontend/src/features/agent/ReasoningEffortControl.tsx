import { RotateCcw } from 'lucide-react'
import type { CSSProperties } from 'react'

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
  const options = levels.length ? [undefined, ...levels] : [undefined]
  const index = Math.max(0, options.indexOf(value))
  const unavailable = disabled || !hasModel || !levels.length
  const label = reasoningEffortLabel(options[index])
  const description = !hasModel ? '选择模型后可设置思考强度。'
    : !levels.length ? '当前模型暂无可选档位，沿用默认设置。'
      : !value && defaultValue ? `沿用模型设置（${reasoningEffortLabel(defaultValue)}）` : undefined

  return <div className="agent-reasoning">
    <div className="agent-reasoning__header">
      <span className="agent-reasoning__title">思考强度</span>
      <span className="agent-reasoning__value" aria-live="polite">{label}</span>
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
    <div className="agent-reasoning__ends" aria-hidden="true"><span>默认</span><span>{reasoningEffortLabel(levels.at(-1))}</span></div>
    {description && <p>{description}</p>}
  </div>
}
