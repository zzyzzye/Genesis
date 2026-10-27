import { expect, it } from 'vitest'

import { modelDisplayName } from '../src/features/agent/modelDisplayName'

it.each([
  ['claude-fable-5-1', 'Claude Fable 5.1'],
  ['claude-fable-5', 'Claude Fable 5'],
  ['claude-opus-5-5', 'Claude Opus 5.5'],
  ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5 20250929'],
  ['claude-3-5-haiku-20241022', 'Claude 3.5 Haiku 20241022'],
  ['claude-fable-5-20261027', 'Claude Fable 5 20261027'],
  ['Claude Fable 5.1', 'Claude Fable 5.1'],
  ['gpt-5-20250807', 'GPT 5 20250807'],
])('格式化 %s 为 %s，保留系列、日期与已有名称', (input, expected) => {
  expect(modelDisplayName(input)).toBe(expected)
})
