import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlogAssistant } from '../src/features/blog/agent/BlogAssistant'
import { deleteAiConversations, getAiConversation, listAiConversations, type AiConversation } from '../src/lib/api'
import { studioAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  deleteAiConversations: vi.fn(), getAiConversation: vi.fn(), listAiConversations: vi.fn(),
  getProviderModels: vi.fn().mockResolvedValue({ models: [] }),
}))
const entries: AiConversation[] = ['当前写作对话', '其他历史'].map((title, index) => ({
  id: `history-${index}`, title, title_source: 'manual',
  created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z',
}))
function storedConversationId() {
  const stored = JSON.parse(sessionStorage.getItem('genesis-blog-ai-conversation') ?? '{}') as { conversationId?: string | null }
  return stored.conversationId
}
afterEach(() => { vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear() })

async function setup() {
  localStorage.setItem(studioAuthTokenKey, 'test-placeholder')
  sessionStorage.setItem('genesis-blog-ai-conversation', JSON.stringify({ isOpen: true, conversationId: 'history-0' }))
  vi.mocked(getAiConversation).mockResolvedValue({ ...entries[0]!, messages: [{ role: 'assistant', content: '当前对话中保存的正文', run_id: 'run-0', status: 'completed', error: null }] })
  vi.mocked(listAiConversations).mockResolvedValue(entries)
  render(<BlogAssistant page={{ route: '/blog/studio', section: 'overview', pageType: 'overview' }} editor={null} />)
  await screen.findByText('当前对话中保存的正文')
  fireEvent.click(screen.getByRole('button', { name: '聊天历史' }))
  await screen.findByRole('button', { name: /^其他历史/ })
  fireEvent.click(screen.getByRole('button', { name: '批量删除' }))
}

describe('博客助手删除后的会话恢复', () => {
  it('删除当前对话后重置正文、草稿及存储标识，列表保留其他历史', async () => {
    await setup()
    vi.mocked(deleteAiConversations).mockResolvedValue({ deleted_count: 1 })
    vi.mocked(listAiConversations).mockResolvedValue([entries[1]!])
    fireEvent.click(screen.getByRole('checkbox', { name: '选择对话：当前写作对话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('已删除 1 段历史对话。')
    expect(screen.queryByText('当前对话中保存的正文')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重命名' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /^其他历史/ })).toBeInTheDocument()
    await waitFor(() => expect(storedConversationId()).toBeNull())
    expect(deleteAiConversations).toHaveBeenCalledWith('test-placeholder', { scope: 'selected', ids: ['history-0'] })
  })

  it('删除其他历史保留当前正文和恢复标识，全选排除当前同样保留', async () => {
    await setup()
    vi.mocked(deleteAiConversations).mockResolvedValue({ deleted_count: 1 })
    vi.mocked(listAiConversations).mockResolvedValue([entries[0]!])
    fireEvent.click(screen.getByRole('checkbox', { name: '全选全部历史对话' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择对话：当前写作对话' }))
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('已删除 1 段历史对话。')
    expect(screen.getByText('当前对话中保存的正文')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重命名' })).toBeEnabled()
    expect(storedConversationId()).toBe('history-0')
    expect(deleteAiConversations).toHaveBeenCalledWith('test-placeholder', { scope: 'all', excluded_ids: ['history-0'] })
  })
})
