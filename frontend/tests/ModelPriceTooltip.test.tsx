import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AgentModelPicker } from '../src/features/agent/AgentModelPicker'
import type { AvailableModel } from '../src/lib/api'

afterEach(cleanup)
const luna: AvailableModel = {
  id: 'gpt-5.6-luna', name: 'GPT 5.6 Luna', created: null, context_window: 1050000, billing_mode: 'platform',
  pricing: {
    status: 'available', currency: 'CNY', unit: '1M tokens', group: 'codex-pro', group_ratio: '0.2',
    updated_at: '2026-10-27T00:00:00Z', note: '价格仅供核对，实际费用以上游账单为准。',
    tiers: [
      { name: 'short', condition: '上下文 ≤ 272,000 Token', input: '0.4', output: '2.4', cache_read: '0.04', cache_write: '0.5', cache_write_1h: null },
      { name: 'long', condition: '上下文 > 272,000 Token', input: '0.8', output: '3.6', cache_read: '0.08', cache_write: '1', cache_write_1h: null },
    ],
  },
}

function setup(models = [luna]) {
  const onModelChange = vi.fn()
  render(<AgentModelPicker provider="openai" models={models} model={luna.id} disabled={false} effort={undefined} onProviderChange={vi.fn()} onModelChange={onModelChange} onEffortChange={vi.fn()} />)
  return { onModelChange, button: screen.getByRole('button', { name: /GPT 5.6 Luna/ }) }
}

it('鼠标悬停展示已含分组倍率的分档输入输出价，不改变当前选择', () => {
  const { button, onModelChange } = setup()
  expect(button).not.toHaveTextContent('站点承担')
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  fireEvent.pointerEnter(button, { pointerType: 'mouse' })
  const tooltip = screen.getByRole('tooltip')
  expect(button).toHaveAttribute('aria-describedby', tooltip.id)
  expect(tooltip).not.toHaveTextContent('codex-pro')
  expect(tooltip).not.toHaveTextContent('0.2 倍')
  expect(tooltip).toHaveTextContent('人民币 / 100 万 Token')
  expect(tooltip).toHaveTextContent('¥0.4')
  expect(tooltip).toHaveTextContent('¥2.4')
  expect(tooltip).toHaveTextContent('¥3.6')
  expect(tooltip).toHaveTextContent('上下文 > 272,000 Token')
  expect(within(tooltip).queryByText('缓存写入 · 1 小时')).not.toBeInTheDocument()
  expect(onModelChange).not.toHaveBeenCalled()
  fireEvent.click(button)
  expect(onModelChange).toHaveBeenCalledWith(luna.id)
})

it('键盘聚焦显示价格，Escape 仅关闭提示且不改变模型', () => {
  const { button, onModelChange } = setup()
  fireEvent.focus(button)
  expect(screen.getByRole('tooltip')).toBeVisible()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(onModelChange).not.toHaveBeenCalled()
})

it('失败不显示零价格，搜索时关闭过期提示', () => {
  const { button } = setup([{ ...luna, pricing: { ...luna.pricing!, status: 'unavailable', tiers: [], note: '分组倍率尚未取得。' } }])
  fireEvent.pointerEnter(button)
  expect(screen.getByRole('tooltip')).toHaveTextContent('分组倍率尚未取得。')
  expect(screen.getByRole('tooltip')).not.toHaveTextContent('¥0')
  fireEvent.change(screen.getByRole('textbox', { name: '搜索模型' }), { target: { value: 'no-match' } })
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(screen.getByText('没有匹配的模型，试试其他名称。')).toBeVisible()
})

it('空目录保持空态，免费价格明确显示为零', () => {
  const view = render(<AgentModelPicker provider="openai" models={[]} model="" disabled={false} effort={undefined} onProviderChange={vi.fn()} onModelChange={vi.fn()} onEffortChange={vi.fn()} />)
  expect(screen.getByText('当前服务商没有可用模型。')).toBeVisible()
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  view.unmount()
  const { button } = setup([{ ...luna, pricing: { ...luna.pricing!, status: 'free', group: null, tiers: [{ name: 'free', condition: null, input: '0', output: '0', cache_read: null, cache_write: null, cache_write_1h: null }], note: '免费使用' } }])
  fireEvent.pointerEnter(button)
  expect(within(screen.getByRole('tooltip')).getAllByText('¥0')).toHaveLength(2)
})
