import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { BlogAssistant } from '../src/features/blog/agent/BlogAssistant'
import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { createAiChatRun, getProviderModels, streamAiChat, streamAiChatRun } from '../src/lib/api'
import { studioAuthTokenKey } from '../src/lib/auth'
import { ReasoningEffortControl } from '../src/features/agent/ReasoningEffortControl'
import { AgentModelPicker } from '../src/features/agent/AgentModelPicker'

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  getProviderModels: vi.fn(),
  createAiChatRun: vi.fn(),
  streamAiChat: vi.fn().mockResolvedValue(undefined),
  streamAiChatRun: vi.fn().mockResolvedValue('completed'),
}))

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
})

function setupModels() {
  vi.mocked(getProviderModels).mockImplementation((_token, provider) => Promise.resolve({
    provider,
    models: [
      { id: 'known', name: '可调模型', created: null, context_window: null, reasoning_effort_levels: ['low', 'high'], reasoning_effort_default: 'low' },
      { id: 'unknown', name: '未知模型', created: null, context_window: null },
    ],
  }))
}

it('博客按模型记忆档位，未知模型用默认，请求携带当前强度', async () => {
  setupModels()
  vi.mocked(createAiChatRun).mockResolvedValue({ id: 'effort-run', status: 'pending' })
  localStorage.setItem(studioAuthTokenKey, 'test-placeholder')
  sessionStorage.setItem('genesis-blog-ai-conversation', JSON.stringify({ isOpen: true, messages: [] }))
  render(<BlogAssistant page={{ route: '/blog/studio/posts', section: 'posts', pageType: 'posts_list' }} editor={null} />)
  const trigger = screen.getByRole('button', { name: '选择模型' })
  fireEvent.click(trigger)
  const slider = await screen.findByRole('slider', { name: '思考强度' })
  await waitFor(() => expect(slider).toBeEnabled())
  fireEvent.change(slider, { target: { value: '2' } })
  expect(slider).toHaveAttribute('aria-valuetext', '高')
  fireEvent.click(screen.getByRole('button', { name: '未知模型' }))
  fireEvent.click(trigger)
  expect(screen.getByText('当前模型暂无可选档位，沿用默认设置。')).toBeInTheDocument()
  expect(screen.getByRole('slider', { name: '思考强度' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '可调模型' }))
  fireEvent.click(trigger)
  expect(screen.getByRole('slider', { name: '思考强度' })).toHaveAttribute('aria-valuetext', '高')
  fireEvent.keyDown(document, { key: 'Escape' })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '测试' } })
  fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
  await waitFor(() => expect(createAiChatRun).toHaveBeenCalledWith('test-placeholder', expect.objectContaining({ model: 'known', reasoning_effort: 'high' })))
  await waitFor(() => expect(streamAiChatRun).toHaveBeenCalled())
})

it('影音使用相同控件，默认不传档位，选择后发送强度', async () => {
  setupModels()
  render(<MediaAssistant token="test-placeholder" page="projects" selectedNode={null} />)
  fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  await waitFor(() => expect(screen.getByRole('slider', { name: '思考强度' })).toBeEnabled())
  const input = screen.getByRole('textbox', { name: '向镜头搭档提问' })
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.change(input, { target: { value: '默认任务' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await waitFor(() => expect(streamAiChat).toHaveBeenCalledWith('test-placeholder', expect.objectContaining({ reasoning_effort: undefined }), expect.any(Function)))
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  fireEvent.change(screen.getByRole('slider', { name: '思考强度' }), { target: { value: '2' } })
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.change(input, { target: { value: '认真规划' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await waitFor(() => expect(streamAiChat).toHaveBeenLastCalledWith('test-placeholder', expect.objectContaining({ surface: 'media', reasoning_effort: 'high' }), expect.any(Function)))
})

it('滑杆可恢复默认，无模型和执行期间不能修改', () => {
  const onChange = vi.fn()
  const props = { levels: ['low', 'medium', 'high'], value: 'medium', hasModel: true, disabled: false, onChange }
  const { rerender } = render(<ReasoningEffortControl {...props} />)
  expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '中')
  fireEvent.click(screen.getByRole('button', { name: '恢复默认思考强度' }))
  expect(onChange).toHaveBeenCalledWith(undefined)
  rerender(<ReasoningEffortControl {...props} disabled />)
  expect(screen.getByRole('slider')).toBeDisabled()
  expect(screen.getByRole('button')).toBeDisabled()
  rerender(<ReasoningEffortControl {...props} hasModel={false} />)
  expect(screen.getByRole('slider')).toBeDisabled()
  expect(screen.getByText('选择模型后可设置思考强度。')).toBeInTheDocument()
})

it('共享模型选择器支持搜索、空态与供应商切换后清空搜索', () => {
  const onProviderChange = vi.fn()
  const onModelChange = vi.fn()
  render(<AgentModelPicker provider="openai" models={[
    { id: 'alpha', name: 'Alpha', created: null, context_window: 128000 },
    { id: 'beta', name: 'Beta', created: null, context_window: null },
  ]} model="alpha" disabled={false} effort={undefined} onProviderChange={onProviderChange} onModelChange={onModelChange} onEffortChange={vi.fn()} />)
  fireEvent.change(screen.getByRole('textbox', { name: '搜索模型' }), { target: { value: 'beta' } })
  expect(screen.queryByRole('button', { name: 'Alpha 128K' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
  expect(onModelChange).toHaveBeenCalledWith('beta')
  fireEvent.change(screen.getByRole('textbox', { name: '搜索模型' }), { target: { value: 'missing' } })
  expect(screen.getByText('没有匹配的模型，试试其他名称。')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '切换到 Grok 模型' }))
  expect(onProviderChange).toHaveBeenCalledWith('grok')
  expect(screen.getByRole('textbox', { name: '搜索模型' })).toHaveValue('')
})
