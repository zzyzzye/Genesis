import { fireEvent, render, screen, waitFor, cleanup, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { BlogAssistant } from '../src/features/blog/agent/BlogAssistant'
import { AiChatRunTerminalError, cancelAiChatRun, confirmAiAction, createAiChatRun, streamAiChatRun, getAiConversation, renameAiConversation, type AiActionProposal } from '../src/lib/api'
import { studioAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  createAiChatRun: vi.fn(),
  createAiConversation: vi.fn().mockResolvedValue({ id: 'conversation-1', title: '新对话', title_source: 'pending' }),
  listAiConversations: vi.fn().mockResolvedValue([{ id: 'saved-conversation', title: '已保存的博客规划', title_source: 'model', updated_at: '2026-10-10T00:00:00Z' }]),
  getAiConversation: vi.fn(),
  renameAiConversation: vi.fn(),
  cancelAiChatRun: vi.fn().mockResolvedValue(undefined),
  confirmAiAction: vi.fn(),
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

  it('澄清卡片提交回答后继续对话，创建失败可保留选择重试', async () => {
    const question = '\n```user-question\n' + JSON.stringify({ id: 'clarification-1', questions: [{
      question: '文章面向谁？', options: [
        { label: '入门读者', description: '补充背景与例子', recommended: true },
        { label: '专业读者', description: '保留技术细节' },
      ],
    }] }) + '\n```\n'
    vi.mocked(createAiChatRun).mockRejectedValueOnce(new Error('创建失败')).mockResolvedValue({ id: 'answer-run', status: 'pending' })
    vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
      callbacks.onToken('按你的选择继续。', 1)
      return Promise.resolve('completed')
    })
    mount([{ role: 'assistant', content: question }])
    fireEvent.click(screen.getByRole('button', { name: /入门读者/ }))
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(await screen.findByText('创建失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /入门读者/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '继续' }))
    expect(await screen.findByText('按你的选择继续。')).toBeInTheDocument()
    expect(createAiChatRun).toHaveBeenLastCalledWith('test-placeholder', expect.objectContaining({
      conversation_id: 'conversation-1', messages: [{ role: 'user', content: '文章面向谁？\n入门读者' }],
    }))
    expect(screen.getByText('已询问')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: '补充关键信息' })).not.toBeInTheDocument()
  })

  it('正文没有 JSON 时仍展示工具提议，失败可重试，成功后禁用确认', async () => {
    const proposal: AiActionProposal = {
      type: 'pending_action', proposal_id: 'draft-1', module: 'blog', action: 'create_draft',
      payload: { title: '嫌麻烦的代价' }, summary: '创建草稿', requires_confirmation: true,
      expires_at: '2099-01-01T00:00:00Z', proposal_token: 'test-proposal',
    }
    vi.mocked(createAiChatRun).mockResolvedValue({ id: 'proposal-run', status: 'pending' })
    vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
      callbacks.onToken('请点击确认执行。', 1)
      callbacks.onProposals?.([proposal])
      return Promise.resolve('completed')
    })
    vi.mocked(confirmAiAction).mockRejectedValueOnce(new Error('模拟保存失败')).mockResolvedValue({ action: 'create_draft', post_id: 'post-1', status: 'created' })
    mount([{ role: 'assistant', content: '你好' }])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '写文章' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    const confirm = await screen.findByRole('button', { name: '确认执行' })
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(screen.getByText('嫌麻烦的代价')).toBeInTheDocument()
    fireEvent.click(confirm)
    expect(await screen.findByText('模拟保存失败')).toBeInTheDocument()
    fireEvent.click(confirm)
    expect(await screen.findByRole('button', { name: '已完成' })).toBeDisabled()
    expect(confirmAiAction).toHaveBeenLastCalledWith('test-placeholder', 'test-proposal')
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
        { role: 'assistant', content: '历史回答', run_id: 'saved-run', status: 'completed', error: null, metrics: { output_tokens: 120, token_source: 'actual', output_seconds: 3.004, tokens_per_second: 39.9467, first_token_seconds: 1, total_seconds: 4.1 } },
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
    expect(screen.getByText('3.00 秒').parentElement).toHaveTextContent('输出 3.00 秒')
    expect(screen.getByText('120 tokens · 40.0 tokens/s')).toBeInTheDocument()
    expect(screen.queryByText(/实测/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重命名' }))
    fireEvent.change(screen.getByRole('textbox', { name: '对话标题' }), { target: { value: '我的写作计划' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('我的写作计划')).toBeInTheDocument()
    expect(renameAiConversation).toHaveBeenCalledWith('test-placeholder', 'saved-conversation', '我的写作计划')
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }))
    expect(screen.queryByText('历史回答')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '聊天历史' })).toBeInTheDocument()
  })

  it('历史停止任务显示终态而非等待中，后续聊天不抹去失败原因', async () => {
    vi.mocked(getAiConversation).mockResolvedValue({
      id: 'saved-conversation', title: '历史任务', title_source: 'manual',
      created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z',
      messages: [
        { role: 'user', content: '写文章', run_id: 'stopped', status: 'failed', error: null },
        { role: 'assistant', content: '', run_id: 'stopped', status: 'failed', error: '生成已由用户停止。', metrics: { output_tokens: null, token_source: 'unavailable', output_seconds: null, tokens_per_second: null, first_token_seconds: null, total_seconds: 35 } },
        { role: 'user', content: '啥情况', run_id: 'done', status: 'completed', error: null },
        { role: 'assistant', content: '继续回答', run_id: 'done', status: 'completed', error: null },
      ],
    })
    mount([{ role: 'assistant', content: '你好' }])
    fireEvent.click(screen.getByRole('button', { name: '聊天历史' }))
    fireEvent.click(await screen.findByRole('button', { name: /已保存的博客规划/ }))
    expect(await screen.findByText('已停止，未收到模型正文。')).toBeInTheDocument()
    expect(screen.getByText('35.00 秒')).toBeInTheDocument()
    expect(screen.getByText('未输出')).toBeInTheDocument()
    expect(screen.queryByText('等待中')).not.toBeInTheDocument()
    expect(screen.getByText('继续回答')).toBeInTheDocument()
  })

  it('等待首字期间持续计时，不提前显示输出速度', async () => {
    vi.mocked(streamAiChatRun).mockImplementation(() => new Promise(() => {}))
    localStorage.setItem(studioAuthTokenKey, 'test-placeholder')
    sessionStorage.setItem(sessionKey, JSON.stringify({ isOpen: true, messages: [
      { role: 'user', content: '写文章' },
      { role: 'assistant', content: '', timing: { startedAt: Date.now() - 20000 } },
    ], activeRun: { id: 'waiting', assistantMessageIndex: 1 } }))
    render(<BlogAssistant page={page} editor={null} />)
    expect(await screen.findByText(/模型尚未返回正文/)).toBeInTheDocument()
    expect(screen.getByText(/等待首字/)).toBeInTheDocument()
    expect(screen.queryByText(/tokens\/s/)).not.toBeInTheDocument()
  })

  it('刷新后保留供应商和模型，显示与下次请求一致', async () => {
    sessionStorage.setItem(`${sessionKey}:model-choice`, JSON.stringify({ provider: 'mimo', model: 'mimo-v2.6-flash' }))
    const { getProviderModels } = await import('../src/lib/api')
    vi.mocked(getProviderModels).mockResolvedValue({ provider: 'mimo', models: [{ id: 'mimo-v2.6-flash', name: 'mimo-v2.6-flash', created: null, context_window: 1000000 }] })
    vi.mocked(createAiChatRun).mockRejectedValue(new Error('测试终止'))
    mount([{ role: 'assistant', content: '你好' }])
    expect(await screen.findByText('MiMo V2.6 Flash')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('测试终止')
    expect(createAiChatRun).toHaveBeenCalledWith('test-placeholder', expect.objectContaining({ provider: 'mimo', model: 'mimo-v2.6-flash' }))
    vi.mocked(getProviderModels).mockResolvedValue({ provider: 'openai', models: [] })
  })
})
