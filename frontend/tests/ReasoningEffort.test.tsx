import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { BlogAssistant } from '../src/features/blog/agent/BlogAssistant'
import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { createAiChatRun, getProviderModels, streamAiChat, streamAiChatRun } from '../src/lib/api'
import { studioAuthTokenKey } from '../src/lib/auth'

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
  const group = await screen.findByRole('group', { name: '思考强度' })
  await waitFor(() => expect(within(group).getByRole('button', { name: '高' })).toBeEnabled())
  fireEvent.click(within(group).getByRole('button', { name: '高' }))
  expect(within(group).getByRole('button', { name: '高' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '未知模型' }))
  fireEvent.click(trigger)
  expect(screen.getByText('当前模型暂无可选档位，沿用默认设置。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '高' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '可调模型' }))
  fireEvent.click(trigger)
  expect(screen.getByRole('button', { name: '高' })).toHaveAttribute('aria-pressed', 'true')
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
  await screen.findByRole('button', { name: '高' })
  const input = screen.getByRole('textbox', { name: '向镜头搭档提问' })
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.change(input, { target: { value: '默认任务' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await waitFor(() => expect(streamAiChat).toHaveBeenCalledWith('test-placeholder', expect.objectContaining({ reasoning_effort: undefined }), expect.any(Function)))
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  fireEvent.click(screen.getByRole('button', { name: '高' }))
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.change(input, { target: { value: '认真规划' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await waitFor(() => expect(streamAiChat).toHaveBeenLastCalledWith('test-placeholder', expect.objectContaining({ surface: 'media', reasoning_effort: 'high' }), expect.any(Function)))
})
