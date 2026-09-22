import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StudioAssistant } from '../src/studio/StudioAssistant'
import { AiChatRunTerminalError, createAiChatRun, streamAiChatRun } from '../src/lib/api'
import { studioAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  createAiChatRun: vi.fn(),
  streamAiChatRun: vi.fn(),
  getProviderModels: vi.fn().mockResolvedValue({ models: [] }),
}))

const page = { route: '/blog/studio', section: 'dashboard', pageType: 'overview' as const }
const sessionKey = 'genesis-studio-ai-conversation'

function mount(messages: { role: string; content: string }[], activeRun: object | null = null) {
  localStorage.setItem(studioAuthTokenKey, 'test-placeholder')
  sessionStorage.setItem(sessionKey, JSON.stringify({ isOpen: true, messages, activeRun }))
  return render(<StudioAssistant page={page} editor={null} />)
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
    const provider = screen.getByRole('button', { name: '切换到 mimo 模型' })
    fireEvent.pointerDown(provider)
    fireEvent.click(provider)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.pointerDown(screen.getByRole('textbox'))
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

  it('恢复旧会话时清理空回复，发送有效历史并展示后续回复', async () => {
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
      { role: 'user', content: '之前的问题' }, { role: 'user', content: '继续' },
    ])
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
})
