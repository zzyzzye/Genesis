import { useState } from 'react'

import type { AiProvider, AvailableModel } from '../../lib/api'

export function reasoningEffortLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    none: '无', minimal: '最少', low: '低', medium: '中', high: '高', xhigh: '更高', max: '最高',
  }
  return value ? labels[value] ?? value : '默认'
}

export function useReasoningEffort(provider: AiProvider, model: string, selectedModel?: AvailableModel) {
  const [choices, setChoices] = useState<Record<string, string | undefined>>({})
  const key = `${provider}:${model}`
  const levels = selectedModel?.reasoning_effort_levels ?? []
  const choice = choices[key]
  // 每个模型独立记忆；能力变化或加载期间不发送失效档位。
  const effort = choice && levels.includes(choice) ? choice : undefined
  return {
    effort,
    levels,
    setEffort: (next: string | undefined) => setChoices((current) => ({ ...current, [key]: next })),
  }
}
