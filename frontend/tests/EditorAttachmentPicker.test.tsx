import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorAttachmentPicker } from '../src/studio/EditorAttachmentPicker'
import { attachmentMarkdown, fetchAttachmentPreview, getAttachment, listAttachments, updateAttachment, uploadAttachment, type Attachment } from '../src/lib/attachments'
import { ArticleMarkdown } from '../src/features/blog/ArticleMarkdown'

vi.mock('../src/lib/attachments', async original => ({ ...await original<typeof import('../src/lib/attachments')>(), fetchAttachmentPreview: vi.fn(), getAttachment: vi.fn(), listAttachments: vi.fn(), updateAttachment: vi.fn(), uploadAttachment: vi.fn() }))
const file: Attachment = { id: 'file-1', parent_id: null, name: '资料[下载]_<说明>{记录}~~ &copy;.zip', kind: 'file', mime_type: 'image/png', image_mime_type: null, size: 10, is_public: false, created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z' }
const folder: Attachment = { ...file, id: 'folder-1', name: '图片', kind: 'folder' }
const listing = { items: [folder, file], breadcrumbs: [], total: 2, max_upload_bytes: 200 * 1024 * 1024 }
function mount(blocked = false) {
  const access = { token: 'test-placeholder', onOpenChange: vi.fn(), navigation: { blocked, onCancel: vi.fn(), onConfirm: vi.fn() } }
  const onClose = vi.fn(); const onInsert = vi.fn()
  return { ...render(<EditorAttachmentPicker access={access} onClose={onClose} onInsert={onInsert} />), access, onClose, onInsert }
}
beforeEach(() => { vi.mocked(listAttachments).mockResolvedValue(listing); vi.mocked(getAttachment).mockResolvedValue(file); vi.mocked(updateAttachment).mockResolvedValue({ ...file, is_public: true }) })
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('编辑器附件选择', () => {
  it('预览使用同一弹窗，返回保留选中项，插入仍需确认公开', async () => {
    const textFile = { ...file, preview_mime_type: 'text/plain' }
    vi.mocked(listAttachments).mockResolvedValue({ ...listing, items: [textFile] })
    vi.mocked(fetchAttachmentPreview).mockResolvedValue({ blob: { type: 'text/plain', text: () => Promise.resolve('附件预览正文') } as Blob, truncated: false })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '预览：' + file.name }))
    expect(await screen.findByText('附件预览正文')).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '← 返回附件列表' })).toHaveFocus()
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { bubbles: true, cancelable: true }))
    expect(screen.getByRole('button', { name: /资料/, pressed: true })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '预览：' + file.name })).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: '插入正文' }))
    expect(screen.getByRole('button', { name: '确认公开并插入' })).toBeInTheDocument()
    expect(updateAttachment).not.toHaveBeenCalled()
  })
  it('服务端识别图片，文件名作为纯文本显示，其他文件生成下载链接', () => {
    const view = render(<ArticleMarkdown>{attachmentMarkdown(file)}</ArticleMarkdown>)
    expect(screen.getByRole('link', { name: file.name })).toHaveAttribute('href', expect.stringContaining('/file'))
    expect(view.container.querySelector('说明')).toBeNull()
    view.rerender(<ArticleMarkdown>{attachmentMarkdown({ ...file, image_mime_type: 'image/png' })}</ArticleMarkdown>)
    expect(screen.getByRole('img', { name: file.name })).toHaveAttribute('src', expect.stringContaining('/image'))
  })

  it('选择私有附件先确认公开，取消保留选择，确认成功只插入一次', async () => {
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp('资料'), pressed: false }))
    fireEvent.click(screen.getByRole('button', { name: '插入正文' }))
    expect(screen.getByRole('dialog', { name: '公开附件并插入' })).toHaveTextContent('即使文章仍是草稿')
    expect(updateAttachment).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '返回选择' }))
    expect(screen.getByRole('button', { name: new RegExp('资料'), pressed: true })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '插入正文' }))
    const confirm = screen.getByRole('button', { name: '确认公开并插入' }); fireEvent.click(confirm); fireEvent.click(confirm)
    await waitFor(() => expect(view.onInsert).toHaveBeenCalledTimes(1))
    expect(updateAttachment).toHaveBeenCalledWith('test-placeholder', file, { name: file.name, parent_id: null, is_public: true })
  })

  it('插入前重取权限，另一标签页撤回后重新确认；读取失败保留选择', async () => {
    vi.mocked(listAttachments).mockResolvedValue({ ...listing, items: [{ ...file, is_public: true }] })
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: new RegExp('资料'), pressed: false }))
    vi.mocked(getAttachment).mockRejectedValueOnce(new Error('附件已删除'))
    fireEvent.click(screen.getByRole('button', { name: '插入正文' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('附件已删除')
    fireEvent.click(screen.getByRole('button', { name: '插入正文' }))
    await screen.findByRole('dialog', { name: '公开附件并插入' })
    expect(view.onInsert).not.toHaveBeenCalled(); expect(updateAttachment).not.toHaveBeenCalled()
  })

  it('文件夹、搜索与分页保持有界；空态、读取失败可恢复', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /^图片/ }))
    await waitFor(() => expect(listAttachments).toHaveBeenLastCalledWith('test-placeholder', 'folder-1', '', 1, expect.any(AbortSignal)))
    vi.mocked(listAttachments).mockRejectedValueOnce(new Error('列表离线'))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索当前文件夹附件' }), { target: { value: '空查询' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('列表离线')
    vi.mocked(listAttachments).mockResolvedValueOnce({ ...listing, items: [], total: 0 })
    fireEvent.click(screen.getByRole('button', { name: '重新加载附件' }))
    await screen.findByText('没有匹配的附件')
    expect(screen.getByRole('button', { name: '插入正文' })).toBeDisabled()
  })

  it('上传停止保留同一 UUID 重试，成功后先选择再公开', async () => {
    let cancelSignal!: AbortSignal
    vi.mocked(uploadAttachment).mockImplementationOnce((_token, _id, _file, _parent, _path, progress, signal) => new Promise((_resolve, reject) => {
      cancelSignal = signal; progress(100); signal.addEventListener('abort', () => reject(new DOMException('已停止等待', 'AbortError')))
    })).mockResolvedValueOnce(file)
    const view = mount()
    await screen.findByRole('button', { name: /^图片/ })
    const input = screen.getByLabelText('上传正文附件')
    expect(input).not.toHaveAttribute('accept')
    fireEvent.change(input, { target: { files: [new File(['any'], '资料.any')] } })
    expect(screen.getByText('正在保存…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '插入正文' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '停止上传' }))
    await screen.findByRole('button', { name: '重试核对上传' })
    expect(cancelSignal.aborted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重试核对上传' }))
    await screen.findByText(`已选：${file.name}`)
    expect(vi.mocked(uploadAttachment).mock.calls[0]?.[1]).toBe(vi.mocked(uploadAttachment).mock.calls[1]?.[1])
    expect(updateAttachment).not.toHaveBeenCalled(); expect(view.onInsert).not.toHaveBeenCalled()
  })

  it('分页请求只取当前页，目录变更回到第一页，公开失败保留原选择', async () => {
    vi.mocked(listAttachments).mockResolvedValue({ ...listing, total: 21 })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }))
    await waitFor(() => expect(listAttachments).toHaveBeenLastCalledWith('test-placeholder', null, '', 2, expect.any(AbortSignal)))
    fireEvent.click(await screen.findByRole('button', { name: /^图片/ }))
    await waitFor(() => expect(listAttachments).toHaveBeenLastCalledWith('test-placeholder', 'folder-1', '', 1, expect.any(AbortSignal)))
    fireEvent.click(await screen.findByRole('button', { name: /资料/, pressed: false }))
    fireEvent.click(screen.getByRole('button', { name: '插入正文' }))
    vi.mocked(updateAttachment).mockRejectedValueOnce(new Error('附件已更新，请刷新后重试'))
    fireEvent.click(screen.getByRole('button', { name: '确认公开并插入' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('附件已更新')
    expect(screen.getByText(`已选：${file.name}`)).toBeInTheDocument()
  })

  it('导航确认复用同一个模态，进行中不能离开，停止后才可离开', async () => {
    let signal!: AbortSignal
    vi.mocked(uploadAttachment).mockImplementationOnce((_token, _id, _file, _parent, _path, _progress, abort) => new Promise((_resolve, reject) => {
      signal = abort; abort.addEventListener('abort', () => reject(new DOMException('停止上传', 'AbortError')))
    }))
    const view = mount()
    await screen.findByRole('button', { name: /^图片/ })
    fireEvent.change(screen.getByLabelText('上传正文附件'), { target: { files: [new File(['x'], 'x.any')] } })
    view.rerender(<EditorAttachmentPicker access={{ ...view.access, navigation: { ...view.access.navigation, blocked: true } }} onClose={view.onClose} onInsert={view.onInsert} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '确认离开' })).toBeDisabled()
    await act(async () => { signal.throwIfAborted(); fireEvent.click(screen.getByRole('button', { name: '停止上传' })); await Promise.resolve() })
    fireEvent.click(screen.getByRole('button', { name: '确认离开' }))
    expect(view.access.navigation.onConfirm).toHaveBeenCalledOnce()
  })
})
