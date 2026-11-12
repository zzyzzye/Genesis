import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { emptyDocument } from '../src/pages/media/api'
import { confirmAiAction, type AiActionProposal } from '../src/lib/api'
import { cancelAiChatRun, createAiChatRun, createAiConversation, getAiConversation, listAiConversations, renameAiConversation, streamAiChatRun } from '../src/lib/api'
import { accountAuthTokenKey, studioAuthTokenKey } from '../src/lib/auth'
import { uploadAttachment } from '../src/lib/attachments'

vi.mock('../src/lib/attachments', async original => ({
  ...await original<typeof import('../src/lib/attachments')>(), uploadAttachment: vi.fn(),
}))

vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(),
  getProviderModels: vi.fn().mockResolvedValue({ models: [] }),
  createAiConversation: vi.fn(), createAiChatRun: vi.fn(), streamAiChatRun: vi.fn(),
  getAiConversation: vi.fn(), listAiConversations: vi.fn(), renameAiConversation: vi.fn(),
  cancelAiChatRun: vi.fn().mockResolvedValue(undefined),
  confirmAiAction: vi.fn(),
}))
const saved = { id: 'media-history', title: '雨夜分镜', title_source: 'manual' as const, created_at: '', updated_at: '' }
const props = { userId: 'creator', attachmentsAllowed: true, page: 'projects' as const, selectedNode: null }

const proposal: AiActionProposal = { type: 'pending_action', module: 'media', action: 'edit_media_canvas', proposal_id: 'canvas-proposal', proposal_token: 'synthetic-proposal', summary: '保存画布修改', requires_confirmation: true, expires_at: '2099-01-01', payload: { document: { nodes: [{ id: 'node', name: '雨夜镜头', text: '雨夜街景' }] } } }
const resource = { module: 'media', kind: 'canvas_edit', id: 'receipt', scope_id: 'project', parent_id: 'project' }

it('媒体审阅确认后才同步，失败保留回执并可重试同步，不重复执行', async () => {
  const syncCanvas = vi.fn().mockRejectedValueOnce(new Error('断网')).mockResolvedValue(undefined)
  vi.mocked(confirmAiAction).mockResolvedValue({ action: 'edit_media_canvas', status: 'completed', resource })
  vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
    callbacks.onProposals?.([proposal]); return Promise.resolve('completed')
  })
  render(<MediaAssistant {...props} page="canvas" projectId="project" canvasActions={{ save: vi.fn().mockResolvedValue(undefined), getDocument: emptyDocument, attachImageTask: vi.fn(), syncCanvas }} />)
  fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
  fireEvent.change(screen.getByRole('textbox', { name: '向镜头搭档提问' }), { target: { value: '增加雨夜镜头' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  const confirm = await screen.findByRole('button', { name: '确认执行' })
  await waitFor(() => expect(confirm).toBeEnabled())
  expect(syncCanvas).not.toHaveBeenCalled()
  fireEvent.click(confirm)
  await screen.findByText(/操作已执行，但画布同步失败/)
  expect(screen.getByRole('button', { name: '已完成' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '重试同步' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '重试同步' })).not.toBeInTheDocument())
  expect(confirmAiAction).toHaveBeenCalledTimes(1)
  expect(syncCanvas).toHaveBeenCalledTimes(2)
})

it('媒体自动模式传到服务端，只读画布仍能发送讨论', async () => {
  vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
    callbacks.onSnapshot('可以讨论镜头', 1); return Promise.resolve('completed')
  })
  const view = render(<MediaAssistant {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
  fireEvent.change(screen.getByLabelText('Agent 执行方式'), { target: { value: 'automatic' } })
  fireEvent.change(screen.getByRole('textbox', { name: '向镜头搭档提问' }), { target: { value: '讨论镜头' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await screen.findByText('可以讨论镜头')
  expect(createAiChatRun).toHaveBeenLastCalledWith('media-test-session', expect.objectContaining({ execution_mode: 'automatic' }))
  view.rerender(<MediaAssistant {...props} page="canvas" projectId="project" canvasActions={{ readOnly: true, save: async () => {}, getDocument: emptyDocument, attachImageTask: vi.fn() }} />)
  expect(screen.queryByLabelText('Agent 执行方式')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: '向镜头搭档提问' }), { target: { value: '这个只读镜头怎么样' } })
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await waitFor(() => expect(createAiChatRun).toHaveBeenCalledTimes(2))
  expect(createAiChatRun).toHaveBeenLastCalledWith('media-test-session', expect.objectContaining({ execution_mode: 'approval_required' }))
})

it('历史执行回执恢复同步，旧 canvas-plan 不再提供重复应用按钮', async () => {
  sessionStorage.setItem('genesis-media-ai-conversation:creator', JSON.stringify({ isOpen: true, conversationId: saved.id }))
  vi.mocked(getAiConversation).mockResolvedValue({ ...saved, messages: [{ role: 'assistant', content: '```canvas-plan\n{}\n```', run_id: 'past-run', status: 'completed', error: null, proposals: [{ ...proposal, executed: true, execution_result: { resource } }] }] })
  const syncCanvas = vi.fn().mockResolvedValue(undefined)
  render(<MediaAssistant {...props} page="canvas" projectId="project" canvasActions={{ save: async () => {}, getDocument: emptyDocument, attachImageTask: vi.fn(), syncCanvas }} />)
  await waitFor(() => expect(syncCanvas).toHaveBeenCalledTimes(1))
  expect(screen.queryByRole('button', { name: '应用到画布' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '已完成' })).toBeDisabled()
  expect(confirmAiAction).not.toHaveBeenCalled()
})

beforeEach(() => {
  localStorage.setItem(accountAuthTokenKey, 'media-test-session')
  localStorage.setItem(studioAuthTokenKey, 'separate-blog-test-session')
  vi.mocked(createAiConversation).mockResolvedValue(saved)
  vi.mocked(createAiChatRun).mockResolvedValue({ id: 'media-run', status: 'pending' })
  vi.mocked(listAiConversations).mockResolvedValue([saved])
  vi.mocked(getAiConversation).mockResolvedValue({ ...saved, messages: [{ role: 'assistant', content: '保存过的镜头规划', run_id: 'past-run', status: 'completed', error: null }] })
})
afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks() })

it('历史回复包含付费账务信息时，对话仍不展示结算状态和账单入口', async () => {
  sessionStorage.setItem('genesis-media-ai-conversation:creator', JSON.stringify({ isOpen: true, conversationId: saved.id }))
  vi.mocked(getAiConversation).mockResolvedValue({
    ...saved,
    messages: [{ role: 'assistant', content: '已完成镜头规划。', run_id: 'paid-run', status: 'completed', error: null,
      billing: { id: 'paid-operation', kind: 'agent', provider: 'openai', model: 'test', mode: 'paid', status: 'pending', reserved_amount: '0', charged_amount: '0', cost_amount: null, currency: 'CNY', note: '', expires_at: '' },
    }],
  })
  render(<MediaAssistant {...props} />)
  await screen.findByText('已完成镜头规划。')
  expect(screen.queryByText('待结算')).not.toBeInTheDocument()
  expect(screen.queryByText('查看账单')).not.toBeInTheDocument()
})

it('影音附件使用账户上传接口，失败可重试并在发送时提交附件标识', async () => {
  const item = { id: 'attachment', name: '分镜.txt', size: 5, mime_type: 'text/plain', kind: 'file' as const, parent_id: null, is_public: false, created_at: '', updated_at: '' }
  vi.mocked(uploadAttachment).mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(item)
  vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
    callbacks.onSnapshot('已读取分镜。', 1)
    return Promise.resolve('completed')
  })
  render(<MediaAssistant {...props} />)
  fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
  expect(screen.getByRole('button', { name: '添加附件' })).toBeEnabled()
  fireEvent.change(screen.getByLabelText('选择 Agent 附件'), { target: { files: [new File(['story'], '分镜.txt')] } })
  await screen.findByText('网络中断')
  fireEvent.click(screen.getByRole('button', { name: '重试上传：分镜.txt' }))
  await screen.findByText(/已上传/)
  const firstCall = vi.mocked(uploadAttachment).mock.calls[0]!
  expect(firstCall[0]).toBe('media-test-session')
  expect(firstCall[7]).toBe('/media/agent/attachments')
  expect(vi.mocked(uploadAttachment).mock.calls[1]![1]).toBe(firstCall[1])
  fireEvent.click(screen.getByRole('button', { name: '发送给镜头搭档' }))
  await screen.findByText('已读取分镜。')
  expect(createAiChatRun).toHaveBeenCalledWith('media-test-session', expect.objectContaining({
    surface: 'media', messages: [{ role: 'user', content: '', attachment_ids: [firstCall[1]] }],
  }))
})

it('影音发送复用持久化任务与账户会话，停止生成保留已收到的正文', async () => {
  vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => {
    callbacks.onSnapshot('先从雨夜空镜开始。', 1)
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
