import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { cancelAiChatRun, createAiChatRun, createAiConversation, getAiConversation, listAiConversations, renameAiConversation, streamAiChatRun } from '../src/lib/api'
import { accountAuthTokenKey, studioAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(),
  getProviderModels: vi.fn().mockResolvedValue({ models: [] }),
  createAiConversation: vi.fn(), createAiChatRun: vi.fn(), streamAiChatRun: vi.fn(),
  getAiConversation: vi.fn(), listAiConversations: vi.fn(), renameAiConversation: vi.fn(),
  cancelAiChatRun: vi.fn().mockResolvedValue(undefined),
}))
const saved = { id: 'media-history', title: '雨夜分镜', title_source: 'manual' as const, created_at: '', updated_at: '' }
const props = { userId: 'creator', attachmentsAllowed: true, page: 'projects' as const, selectedNode: null }

beforeEach(() => {
  localStorage.setItem(accountAuthTokenKey, 'media-test-session')
  localStorage.setItem(studioAuthTokenKey, 'separate-blog-test-session')
  vi.mocked(createAiConversation).mockResolvedValue(saved)
  vi.mocked(createAiChatRun).mockResolvedValue({ id: 'media-run', status: 'pending' })
  vi.mocked(listAiConversations).mockResolvedValue([saved])
  vi.mocked(getAiConversation).mockResolvedValue({ ...saved, messages: [{ role: 'assistant', content: '保存过的镜头规划', run_id: 'past-run', status: 'completed', error: null }] })
})
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks() })

it('影音发送复用持久化任务与账户会话，停止生成保留已收到的正文', async () => {
  vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
    callbacks.onToken('先从雨夜空镜开始。', 1)
    return new Promise(() => undefined)
  })
  render(<MediaAssistant {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
  fireEvent.change(screen.getByRole('textbox', { name: '向镜头搭档提问' }), { target: { value: '规划雨夜开场' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await screen.findByRole('button', { name: '停止生成' })
  expect(createAiConversation).toHaveBeenCalledWith('media-test-session', 'media')
  expect(createAiChatRun).toHaveBeenCalledWith('media-test-session', expect.objectContaining({
    surface: 'media', conversation_id: saved.id, execution_mode: 'approval_required',
    messages: [{ role: 'user', content: '规划雨夜开场' }],
  }))
  expect(vi.mocked(createAiChatRun).mock.calls[0]?.[1].context).toMatchObject({ module: 'media', page_type: 'projects' })
  // 停止按钮出现时流连接可能尚未开始，先确认正文实际到达。
  await screen.findByText('先从雨夜空镜开始。')
  fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
  expect(cancelAiChatRun).toHaveBeenCalledWith('media-test-session', 'media-run')
  expect(await screen.findByText('先从雨夜空镜开始。')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
})

it('刷新从影音目录恢复正文和重命名，历史请求不使用博客会话', async () => {
  sessionStorage.setItem('genesis-media-ai-conversation:creator', JSON.stringify({ isOpen: true, conversationId: saved.id }))
  vi.mocked(renameAiConversation).mockResolvedValue({ ...saved, title: '新的分镜标题' })
  render(<MediaAssistant {...props} />)
  expect(await screen.findByText('保存过的镜头规划')).toBeInTheDocument()
  expect(getAiConversation).toHaveBeenCalledWith('media-test-session', saved.id, 'media')
  fireEvent.click(screen.getByRole('button', { name: '重命名' }))
  fireEvent.change(screen.getByRole('textbox', { name: '对话标题' }), { target: { value: '新的分镜标题' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText('新的分镜标题')
  expect(renameAiConversation).toHaveBeenCalledWith('media-test-session', saved.id, '新的分镜标题', 'media')
  fireEvent.click(screen.getByRole('button', { name: '聊天历史' }))
  await waitFor(() => expect(listAiConversations).toHaveBeenCalledWith('media-test-session', 0, 'media'))
  expect(await screen.findByRole('button', { name: /^雨夜分镜/ })).toBeInTheDocument()
})
