import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlogAssistant } from '../src/features/blog/agent/BlogAssistant'
import { createAiChatRun, createAiConversation, getAiConversation, getProviderModels, streamAiChatRun } from '../src/lib/api'
import { uploadAttachment } from '../src/lib/attachments'
import { studioAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(),
  createAiChatRun: vi.fn(), getAiConversation: vi.fn(), getProviderModels: vi.fn(),
  createAiConversation: vi.fn().mockResolvedValue({ id: 'new-id', title: '新对话' }),
  listAiConversations: vi.fn().mockResolvedValue([]), streamAiChatRun: vi.fn(),
}))
vi.mock('../src/lib/attachments', async original => ({
  ...await original<typeof import('../src/lib/attachments')>(), uploadAttachment: vi.fn(),
}))
const page = { route: '/blog/studio', section: 'overview', pageType: 'overview' as const }
const saved = { id: 'file-id', name: '参考.md', size: 7, mime_type: 'text/plain', kind: 'file' as const, parent_id: null, is_public: false, created_at: '', updated_at: '' }

beforeEach(() => {
  localStorage.setItem(studioAuthTokenKey, 'test-placeholder')
  sessionStorage.setItem('genesis-blog-ai-conversation', JSON.stringify({ isOpen: true }))
  vi.mocked(getProviderModels).mockResolvedValue({ provider: 'openai', models: [{ id: 'gpt-4o', name: 'GPT-4o', created: null, context_window: 128000, image_inputs: true, video_inputs: false }] })
  vi.mocked(createAiChatRun).mockResolvedValue({ id: 'run-id', status: 'pending' })
  vi.mocked(createAiConversation).mockResolvedValue({ id: 'new-id', title: '新对话', title_source: 'manual', created_at: '', updated_at: '' })
  vi.mocked(streamAiChatRun).mockImplementation((_token, _id, callbacks) => { callbacks.onSnapshot('已根据附件完成整理。', 1); return Promise.resolve('completed') })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear() })

function select(file: File) { fireEvent.change(screen.getByLabelText('选择 Agent 附件'), { target: { files: [file] } }) }

describe('博客助手附件输入', () => {
  it('上传中阻止发送，完成后可单独发送附件，历史消息保留文件且不公开', async () => {
    let complete: ((value: typeof saved) => void) | undefined
    vi.mocked(uploadAttachment).mockImplementation(() => new Promise(resolve => { complete = resolve }))
    render(<BlogAssistant page={page} editor={null} />)
    select(new File(['# 参考'], '参考.md', { type: 'text/plain' }))
    expect(await screen.findByText('上传中 0%')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    await act(async () => { complete?.(saved); await Promise.resolve() })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled())
    const id = vi.mocked(uploadAttachment).mock.calls[0]![1]
    expect(vi.mocked(uploadAttachment).mock.calls[0]![4]).toBe(`Agent 附件/${id}/参考.md`)
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('已根据附件完成整理。')
    expect(vi.mocked(createAiChatRun).mock.calls[0]![1].messages).toEqual([{ role: 'user', content: '', attachment_ids: [id] }])
    expect(screen.queryByRole('list', { name: '待发送附件' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '消息附件' })).getByRole('button', { name: '参考.md' })).toBeInTheDocument()
    expect(uploadAttachment).toHaveBeenCalledTimes(1)
  })

  it('上传失败以相同 UUID 重试，任务创建失败保留附件和文字并可再次发送', async () => {
    vi.mocked(uploadAttachment).mockRejectedValueOnce(new Error('网络中断')).mockResolvedValue(saved)
    vi.mocked(createAiChatRun).mockRejectedValueOnce(new Error('任务创建失败')).mockResolvedValue({ id: 'retry-run', status: 'pending' })
    render(<BlogAssistant page={page} editor={null} />)
    select(new File(['text'], '参考.md'))
    await screen.findByText('网络中断')
    fireEvent.click(screen.getByRole('button', { name: '重试上传：参考.md' }))
    await screen.findByText(/已上传/)
    expect(vi.mocked(uploadAttachment).mock.calls[1]![1]).toBe(vi.mocked(uploadAttachment).mock.calls[0]![1])
    fireEvent.change(screen.getByRole('textbox', { name: '向博客助手提问' }), { target: { value: '总结文档' } })
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('任务创建失败')
    expect(screen.getByRole('list', { name: '待发送附件' })).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('总结文档')
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }))
    await screen.findByText('已根据附件完成整理。')
    expect(uploadAttachment).toHaveBeenCalledTimes(2)
    expect(vi.mocked(createAiChatRun).mock.calls[1]![1].messages).toEqual(vi.mocked(createAiChatRun).mock.calls[0]![1].messages)
  })

  it('不支持的视频模型保留附件并提示，移除后恢复发送；空文件不上传', async () => {
    vi.mocked(uploadAttachment).mockResolvedValue({ ...saved, name: '片段.mp4' })
    render(<BlogAssistant page={page} editor={null} />)
    select(new File([], '空文件.txt'))
    await screen.findByText(/请选择非空/)
    expect(uploadAttachment).not.toHaveBeenCalled()
    select(new File(['video'], '片段.mp4', { type: 'video/mp4' }))
    await screen.findByText(/当前模型或通道不支持视频/)
    expect(screen.getByRole('button', { name: '发送消息' })).toBeDisabled()
    await screen.findByText(/已上传/)
    fireEvent.click(screen.getByRole('button', { name: '移除附件：片段.mp4' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '改为纯文字' } })
    expect(screen.getByRole('button', { name: '发送消息' })).toBeEnabled()
  })

  it('重开历史显示服务端保存的附件资料', async () => {
    sessionStorage.setItem('genesis-blog-ai-conversation', JSON.stringify({ isOpen: true, conversationId: 'history-id' }))
    vi.mocked(getAiConversation).mockResolvedValue({ id: 'history-id', title: '附件会话', title_source: 'manual', created_at: '', updated_at: '', messages: [{ role: 'user', content: '', attachments: [{ id: 'file-id', name: '历史文档.pdf', size: 100, mime_type: 'application/pdf', kind: 'document' }], run_id: 'old-run', status: 'completed', error: null }] })
    render(<BlogAssistant page={page} editor={null} />)
    expect(await screen.findByRole('button', { name: '历史文档.pdf' })).toBeInTheDocument()
  })
})
