import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlogAssistant } from '../src/features/blog/agent/BlogAssistant'
import { AiChatRunTerminalError, cancelAiChatRun, createAiChatRun, streamAiChatRun, getAiConversation, renameAiConversation } from '../src/lib/api'
import { studioAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  createAiChatRun: vi.fn(),
  createAiConversation: vi.fn().mockResolvedValue({ id: 'conversation-1', title: '新对话', title_source: 'pending' }),
  listAiConversations: vi.fn().mockResolvedValue([{ id: 'saved-conversation', title: '已保存的博客规划', title_source: 'model', updated_at: '2026-10-10T00:00:00Z' }]),
  getAiConversation: vi.fn(),
  renameAiConversation: vi.fn(),
  cancelAiChatRun: vi.fn().mockResolvedValue(undefined),
  streamAiChatRun: vi.fn(),
  getProviderModels: vi.fn().mockResolvedValue({ models: [] }),
}))

const page = { route: '/blog/studio/posts', section: 'posts', pageType: 'posts_list' as const }
const sessionKey = 'genesis-blog-ai-conversation'

function mount(messages: { role: string; content: string }[], activeRun: object | null = null) {
  localStorage.setItem(studioAuthTokenKey, 'test-placeholder')
  sessionStorage.setItem(sessionKey, JSON.stringify({ isOpen: true, messages, activeRun }))
  return render(<BlogAssistant page={page} editor={null} />)
}

describe('助手失败后的继续对话', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('菜单内部操作保持展开，点击外部或按 Escape 后关闭', async () => {
    mount([{ role: 'assistant', content: '你好' }])
    const trigger = screen.getByRole('button', { name: '选择模型' })
    fireEvent.click(trigger)
    const provider = screen.getByRole('button', { name: '切换到 MiMo 模型' })
    fireEvent.pointerDown(provider)
    fireEvent.click(provider)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(screen.getByRole('textbox', { name: '向博客助手提问' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await act(async () => { await Promise.resolve() })
  })

  it('同帧多段 token 合并后，完成事件仍保留全部文字', async () => {
    vi.mocked(createAiChatRun).mockResolvedValue({ id: 'burst-run', status: 'pending' })
    vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
      callbacks.onSnapshot('', 0)
      for (let i = 0; i < 100; i++) callbacks.onToken('字', i + 1)
      return Promise.resolve('completed' as const)
    })
    mount([{ role: 'assistant', content: '你好' }])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '开始' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('字'.repeat(100))).toBeInTheDocument()
  })

  it('停止生成会取消服务端任务并保留已经收到的内容', async () => {
    vi.mocked(createAiChatRun).mockResolvedValue({ id: 'stop-run', status: 'pending' })
    vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks, signal) => new Promise((_resolve, reject) => {
      callbacks.onToken('已经生成', 1)
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    mount([{ role: 'assistant', content: '你好' }])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '开始' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    const stop = await screen.findByRole('button', { name: '停止生成' })
    await waitFor(() => expect(streamAiChatRun).toHaveBeenCalled())
    fireEvent.click(stop)
    expect(await screen.findByText('已经生成')).toBeInTheDocument()
    expect(cancelAiChatRun).toHaveBeenCalledWith('test-placeholder', 'stop-run')
    expect(screen.getByRole('button', { name: '发送消息' })).toBeInTheDocument()
  })

  it('新会话只发送新增消息，历史由服务端和 checkpoint 管理', async () => {
    vi.mocked(createAiChatRun).mockResolvedValue({ id: 'next-run', status: 'pending' })
    vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
      callbacks.onSnapshot('新的回复', 1)
      return Promise.resolve('completed' as const)
    })
    mount([
      { role: 'user', content: '之前的问题' },
      { role: 'assistant', content: '' },
      { role: 'assistant', content: '  ' },
    ])
    expect(screen.queryByText('正在生成…')).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(await screen.findByText('新的回复')).toBeInTheDocument()
    expect(vi.mocked(createAiChatRun).mock.calls[0]![1].messages).toEqual([
      { role: 'user', content: '继续' },
    ])
    expect(vi.mocked(createAiChatRun).mock.calls[0]![1].conversation_id).toBe('conversation-1')
  })

  it.each(['failed', 'completed'])('运行 %s 且无内容时，移除占位并允许继续发送', async (status) => {
    vi.mocked(streamAiChatRun).mockImplementation(() => {
      if (status === 'failed') return Promise.reject(new AiChatRunTerminalError('上游限流'))
      return Promise.resolve('completed' as const)
    })
    mount([
      { role: 'user', content: '之前的问题' }, { role: 'assistant', content: '' },
    ], { id: 'old-run', assistantMessageIndex: 1 })
    await waitFor(() => expect(screen.queryByText('正在生成…')).not.toBeInTheDocument())
    vi.mocked(createAiChatRun).mockRejectedValue(new Error('测试停止发送'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '重试' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('测试停止发送')
    expect(vi.mocked(createAiChatRun).mock.calls[0]![1].messages.every((m) => m.content.trim())).toBe(true)
  })

  it('超出消息上限时保留输入，提示新建对话且不发送无效请求', async () => {
    mount(Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user', content: `消息 ${i}`,
    })))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    expect(screen.getByText(/已达到 40 条消息上限/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('继续')
    expect(createAiChatRun).not.toHaveBeenCalled()
    await act(async () => { await Promise.resolve() })
  })

  it('从历史恢复消息、重命名并在新建后保留历史入口', async () => {
    vi.mocked(getAiConversation).mockResolvedValue({
      id: 'saved-conversation', title: '已保存的博客规划', title_source: 'model',
      created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
      messages: [
        { role: 'user', content: '历史问题', run_id: 'saved-run', status: 'completed', error: null },
        { role: 'assistant', content: '历史回答', run_id: 'saved-run', status: 'completed', error: null },
      ],
    })
    vi.mocked(renameAiConversation).mockResolvedValue({
      id: 'saved-conversation', title: '我的写作计划', title_source: 'manual',
      created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
    })
    mount([{ role: 'assistant', content: '你好' }])
    fireEvent.click(screen.getByRole('button', { name: '聊天历史' }))
    fireEvent.click(await screen.findByRole('button', { name: /已保存的博客规划/ }))
    expect(await screen.findByText('历史回答')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    fireEvent.change(screen.getByRole('textbox', { name: '对话标题' }), { target: { value: '我的写作计划' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('我的写作计划')).toBeInTheDocument()
    expect(renameAiConversation).toHaveBeenCalledWith('test-placeholder', 'saved-conversation', '我的写作计划')
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    expect(screen.queryByText('历史回答')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '聊天历史' })).toBeInTheDocument()
  })
})
