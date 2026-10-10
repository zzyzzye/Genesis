import { useState } from 'react'

import type { AiProvider, AvailableModel, ThinkingMode } from '../../lib/api'

export function reasoningEffortLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    none: '无', minimal: '最少', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高',
  }
  return value ? labels[value] ?? value : '默认'
}

export function thinkingModeLabel(value: ThinkingMode | undefined) {
  return value === 'enabled' ? '思考开启' : value === 'disabled' ? '思考关闭' : undefined
}

export function useReasoningEffort(provider: AiProvider, model: string, selectedModel?: AvailableModel) {
  const [choices, setChoices] = useState<Record<string, string | undefined>>({})
  const [modes, setModes] = useState<Record<string, ThinkingMode | undefined>>({})
  const key = `${provider}:${model}`
  const levels = selectedModel?.reasoning_effort_levels ?? []
  const choice = choices[key]
  // 每个模型独立记忆；能力变化或加载期间不发送失效档位。
  const effort = choice && levels.includes(choice) ? choice : undefined
  const mode = modes[key]
  return {
    effort,
    levels,
    thinkingMode: mode && selectedModel?.thinking_modes?.includes(mode) ? mode : undefined,
    setThinkingMode: (next: ThinkingMode | undefined) => setModes((current) => ({ ...current, [key]: next })),
    setEffort: (next: string | undefined) => setChoices((current) => ({ ...current, [key]: next })),
  }
}
