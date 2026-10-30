import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GenerationModelPicker } from '../src/pages/media/GenerationModelPicker'
import type { VideoModel } from '../src/pages/media/VideoGeneration'

const models: VideoModel[] = [
  { id: 'request-model', description: '所有参考素材合计最多 4 项。', pricing: { status: 'available', currency: 'CNY', unit: 'request', amount: '0.55', group: null, group_ratio: null, tiers: [], note: '实际上游账单为准。', updated_at: null } },
  { id: 'second-model', description: '视频生成，支持情况见供应商说明。', pricing: { status: 'available', currency: 'CNY', unit: 'second', amount: '0.33', group: null, group_ratio: null, tiers: [], note: '实际上游账单为准。', updated_at: null } },
  { id: 'unknown-model' },
]
afterEach(cleanup)
function setup(value = 'request-model') {
  const onChange = vi.fn()
  render(<GenerationModelPicker models={models} value={value} disabled={false} label="视频生成模型" placeholder="选择模型" onChange={onChange} />)
  return { onChange, trigger: screen.getByRole('button', { name: '视频生成模型' }) }
}

it('悬停当前模型显示上游简介和按次价格，悬停不改变选择', () => {
  const { trigger, onChange } = setup()
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' })
  expect(screen.getByRole('tooltip')).toHaveTextContent('所有参考素材合计最多 4 项。')
  expect(screen.getByRole('tooltip')).toHaveTextContent('¥0.55 / 请求')
  expect(onChange).not.toHaveBeenCalled()
})

it('展开后键盘浏览显示每秒价格，选择关闭菜单并恢复焦点', () => {
  const { trigger, onChange } = setup()
  fireEvent.click(trigger)
  const search = screen.getByRole('textbox', { name: '搜索生成模型' })
  expect(search).toHaveFocus()
  fireEvent.keyDown(search, { key: 'ArrowDown' })
  expect(screen.getByRole('option', { name: 'request-model' })).toHaveFocus()
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  expect(screen.getByRole('option', { name: 'second-model' })).toHaveFocus()
  expect(screen.getByRole('tooltip')).toHaveTextContent('¥0.33 / 秒')
  fireEvent.click(screen.getByRole('option', { name: 'second-model' }))
  expect(onChange).toHaveBeenCalledWith('second-model')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})

it('未知信息不伪造价格，搜索无结果有空态且 Escape 恢复入口', () => {
  const { trigger } = setup('unknown-model')
  fireEvent.focus(trigger)
  const tooltip = screen.getByRole('tooltip')
  expect(tooltip).toHaveTextContent('暂无模型简介')
  expect(within(tooltip).queryByText('¥0')).not.toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.click(trigger)
  const search = screen.getByRole('textbox', { name: '搜索生成模型' })
  fireEvent.change(search, { target: { value: 'missing' } })
  expect(screen.getByText('没有匹配的模型')).toBeInTheDocument()
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(trigger).toHaveFocus()
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
})
