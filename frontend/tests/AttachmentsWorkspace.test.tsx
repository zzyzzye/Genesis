import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttachmentsWorkspace } from '../src/studio/AttachmentsWorkspace'
import { createAttachmentFolder, deleteAttachment, downloadAttachment, listAttachments, updateAttachment, uploadAttachment, type Attachment } from '../src/lib/attachments'

vi.mock('../src/lib/attachments', async (original) => ({ ...await original<typeof import('../src/lib/attachments')>(), createAttachmentFolder: vi.fn(), deleteAttachment: vi.fn(), downloadAttachment: vi.fn(), listAttachments: vi.fn(), updateAttachment: vi.fn(), uploadAttachment: vi.fn() }))
const file: Attachment = { id: 'file-1', parent_id: null, name: '说明.any', kind: 'file', size: 4, mime_type: 'application/octet-stream', is_public: false, created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z' }
const folder: Attachment = { ...file, id: 'folder-1', name: '资料', kind: 'folder', size: 0 }
const listing = { items: [folder, file], total: 2, breadcrumbs: [], max_upload_bytes: 200 * 1024 * 1024 }
function mount(query = '', navigationBlocked = false) {
  const callbacks = { onDirtyChange: vi.fn(), onPendingChange: vi.fn(), onCancelNavigation: vi.fn(), onConfirmNavigation: vi.fn() }
  return { ...render(<MemoryRouter initialEntries={['/blog/studio/attachments' + query]}><AttachmentsWorkspace token="test-placeholder" {...callbacks} navigationBlocked={navigationBlocked} /></MemoryRouter>), ...callbacks }
}
beforeEach(() => vi.mocked(listAttachments).mockResolvedValue(listing))
afterEach(() => { cleanup(); vi.resetAllMocks() })

describe('附件管理', () => {
  it('任意文件与文件夹选择器保持独立，列表与 URL 目录搜索有界', async () => {
    const view = mount('?folder=folder-1&q=测试&page=2')
    await screen.findByRole('list', { name: '附件列表' })
    expect(listAttachments).toHaveBeenCalledWith('test-placeholder', 'folder-1', '测试', 2, expect.any(AbortSignal))
    const inputs = [...view.container.querySelectorAll<HTMLInputElement>('input[type=file]')]
    expect(inputs).toHaveLength(2)
    expect(inputs.every((input) => !input.hasAttribute('accept') && input.multiple)).toBe(true)
    expect(inputs[1]).toHaveAttribute('webkitdirectory')
    fireEvent.click(screen.getByRole('button', { name: '资料' }))
    await waitFor(() => expect(listAttachments).toHaveBeenLastCalledWith('test-placeholder', 'folder-1', '', 1, expect.any(AbortSignal)))
  })

  it('新建校验与网络失败保留输入，同一创建标识重试且阻止重复保存', async () => {
    const view = mount()
    await screen.findByRole('list', { name: '附件列表' })
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const input = screen.getByLabelText('名称')
    expect(input).toHaveFocus()
    fireEvent.change(input, { target: { value: '../无效' } })
    fireEvent.submit(view.container.querySelector('form')!)
    expect(createAttachmentFolder).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(input, { target: { value: '新目录' } })
    vi.mocked(createAttachmentFolder).mockRejectedValueOnce(new Error('存储暂不可用'))
    fireEvent.submit(view.container.querySelector('form')!)
    expect(await screen.findByRole('alert')).toHaveTextContent('存储暂不可用')
    expect(input).toHaveValue('新目录')
    let resolve!: (value: Attachment) => void
    vi.mocked(createAttachmentFolder).mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    fireEvent.submit(view.container.querySelector('form')!); fireEvent.submit(view.container.querySelector('form')!)
    expect(createAttachmentFolder).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled()
    expect(vi.mocked(createAttachmentFolder).mock.calls[0]?.[1]).toBe(vi.mocked(createAttachmentFolder).mock.calls[1]?.[1])
    await act(async () => { resolve({ ...folder, name: '新目录' }); await Promise.resolve() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(view.onPendingChange).toHaveBeenLastCalledWith(false)
  })

  it('重命名保留版本，取消脏表单在同一个弹窗内确认', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '重命名：说明.any' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '新名称.bin' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    expect(screen.getByLabelText('名称')).toHaveValue('新名称.bin')
    vi.mocked(updateAttachment).mockResolvedValueOnce({ ...file, name: '新名称.bin' })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateAttachment).toHaveBeenCalledWith('test-placeholder', file, { name: '新名称.bin', parent_id: null, is_public: false }))
  })

  it('移动使用分页目录选择，不能把自身作为目标，失败保留位置', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '移动：资料' }))
    const picker = await screen.findByRole('list', { name: '可选文件夹' })
    expect(within(picker).getByRole('button', { name: /不能移入自身/ })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    vi.mocked(listAttachments).mockResolvedValueOnce({ ...listing, items: [folder] })
    fireEvent.click(screen.getByRole('button', { name: '移动：说明.any' }))
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: '资料 →' }))
    vi.mocked(listAttachments).mockResolvedValueOnce({ ...listing, items: [], total: 0, breadcrumbs: [folder] })
    await waitFor(() => expect(screen.getByRole('button', { name: '移动到此处' })).not.toBeDisabled())
    vi.mocked(updateAttachment).mockRejectedValueOnce(new Error('附件已更新，请刷新'))
    fireEvent.click(screen.getByRole('button', { name: '移动到此处' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('附件已更新')
    expect(updateAttachment).toHaveBeenCalledWith('test-placeholder', file, { name: file.name, parent_id: folder.id, is_public: false })
  })

  it('公开与永久删除必须确认，下载失败给出可操作反馈', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: '公开：说明.any' }))
    expect(updateAttachment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    expect(screen.getByRole('dialog')).toHaveTextContent('任何拿到链接的人都能下载')
    vi.mocked(updateAttachment).mockResolvedValueOnce({ ...file, is_public: true })
    fireEvent.click(screen.getByRole('button', { name: '确认公开' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(await screen.findByRole('button', { name: '删除：资料' }))
    vi.mocked(deleteAttachment).mockRejectedValueOnce(new Error('文件夹不为空'))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('文件夹不为空')
    expect(deleteAttachment).toHaveBeenCalledWith('test-placeholder', folder)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    vi.mocked(downloadAttachment).mockRejectedValueOnce(new Error('下载网络中断'))
    fireEvent.click(screen.getByRole('button', { name: '下载：说明.any' }))
    expect(await screen.findByText('下载网络中断')).toBeInTheDocument()
  })

  it('文件夹上传保留相对路径；失败重试沿用 UUID，进度 100 仍等待回执', async () => {
    const view = mount()
    await screen.findByRole('list', { name: '附件列表' })
    const input = screen.getByLabelText('选择上传文件夹')
    const selected = new File(['data'], '文件.custom', { type: 'application/custom' })
    Object.defineProperty(selected, 'webkitRelativePath', { value: '目录/子目录/文件.custom' })
    vi.mocked(uploadAttachment).mockRejectedValueOnce(new Error('网络中断'))
    fireEvent.change(input, { target: { files: [selected] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断')
    expect(view.onDirtyChange).toHaveBeenLastCalledWith(true)
    let resolve!: (value: Attachment) => void
    vi.mocked(uploadAttachment).mockImplementationOnce((_token, _id, _file, _parent, _path, progress) => { progress(100); return new Promise((done) => { resolve = done }) })
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText('文件已传输，正在保存…')).toBeInTheDocument()
    expect(vi.mocked(uploadAttachment).mock.calls[0]?.[1]).toBe(vi.mocked(uploadAttachment).mock.calls[1]?.[1])
    expect(vi.mocked(uploadAttachment).mock.calls[1]?.[4]).toBe('目录/子目录/文件.custom')
    await act(async () => { resolve(file); await Promise.resolve() })
    expect(await screen.findByText('已保存 · 私有')).toBeInTheDocument()
    expect(view.onDirtyChange).toHaveBeenLastCalledWith(false)
  })

  it('顺序处理批量文件，停止后保留回执不确定说明，待上传项不会继续发送', async () => {
    const view = mount()
    await screen.findByRole('list', { name: '附件列表' })
    vi.mocked(uploadAttachment).mockImplementationOnce((_token, _id, _file, _parent, _path, progress, signal) => new Promise((_resolve, reject) => { progress(40); signal.addEventListener('abort', () => reject(new DOMException('停止', 'AbortError'))) }))
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [new File(['1'], '1.bin'), new File(['2'], '2.bin')] } })
    expect(await screen.findByText('正在上传 40%')).toBeInTheDocument()
    expect(uploadAttachment).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '停止上传' }))
    expect(await screen.findByText(/服务端可能已保存/)).toBeInTheDocument()
    expect(uploadAttachment).toHaveBeenCalledTimes(1)
    expect(view.onPendingChange).toHaveBeenLastCalledWith(false)
    expect(view.onDirtyChange).toHaveBeenLastCalledWith(true)
    const retry = screen.getAllByRole('button', { name: '继续上传' })[1]!
    vi.mocked(uploadAttachment).mockResolvedValueOnce(file)
    fireEvent.click(retry)
    await screen.findByText('已保存 · 私有')
    expect(uploadAttachment).toHaveBeenCalledTimes(2)
  })

  it('加载失败可重试，无结果可清空搜索，导航提醒允许取消返回队列', async () => {
    vi.mocked(listAttachments).mockRejectedValueOnce(new Error('列表离线')).mockResolvedValueOnce({ ...listing, items: [], total: 0 })
    const view = mount('?q=没有', true)
    expect(screen.getByRole('dialog', { name: '离开附件管理？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(view.onCancelNavigation).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('alert')).toHaveTextContent('列表离线')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('没有匹配的附件')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    await waitFor(() => expect(listAttachments).toHaveBeenLastCalledWith('test-placeholder', null, '', 1, expect.any(AbortSignal)))
  })
})
