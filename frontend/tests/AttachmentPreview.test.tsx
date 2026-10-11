import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttachmentPreviewContent, AttachmentPreviewDialog, AttachmentThumbnail } from '../src/studio/AttachmentPreview'
import { fetchAttachmentPreview, type Attachment } from '../src/lib/attachments'

vi.mock('../src/lib/attachments', async original => ({ ...await original<typeof import('../src/lib/attachments')>(), fetchAttachmentPreview: vi.fn() }))
const image: Attachment = { id: 'image-1', parent_id: null, name: '测试.png', kind: 'file', size: 10, mime_type: 'application/octet-stream', image_mime_type: 'image/png', preview_mime_type: 'image/png', is_public: false, created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z' }
const createUrl = vi.fn(() => 'blob:test-preview')
const revokeUrl = vi.fn()
beforeEach(() => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = revokeUrl })
  vi.mocked(fetchAttachmentPreview).mockResolvedValue({ blob: new Blob(['image'], { type: 'image/png' }), truncated: false })
})
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals() })

describe('私有附件预览', () => {
  it('图片使用鉴权响应的临时地址，关闭时取消请求并释放地址', async () => {
    const view = render(<AttachmentPreviewContent item={image} token="test-placeholder" />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载预览')
    expect(await screen.findByRole('img', { name: image.name })).toHaveAttribute('src', 'blob:test-preview')
    expect(fetchAttachmentPreview).toHaveBeenCalledWith('test-placeholder', image, expect.any(AbortSignal))
    expect(screen.getByText(/私有，仅作者可见/)).toBeInTheDocument()
    const signal = vi.mocked(fetchAttachmentPreview).mock.calls[0]![2]
    view.unmount()
    expect(signal.aborted).toBe(true)
    expect(revokeUrl).toHaveBeenCalledWith('blob:test-preview')
  })

  it('失败可重试；HTML 文本保持纯文本且明确提示截取范围', async () => {
    const raw = '<script>window.bad = true</script>'
    vi.mocked(fetchAttachmentPreview).mockRejectedValueOnce(new Error('预览网络中断')).mockResolvedValueOnce({ blob: { type: 'text/plain; charset=utf-8', text: () => Promise.resolve(raw) } as Blob, truncated: true })
    const view = render(<AttachmentPreviewContent item={{ ...image, image_mime_type: null, preview_mime_type: 'text/plain' }} token="test-placeholder" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('预览网络中断')
    fireEvent.click(screen.getByRole('button', { name: '重新加载预览' }))
    expect(await screen.findByText(raw)).toBeInTheDocument()
    expect(view.container.querySelector('script')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('仅显示前 256 KiB')
    expect(createUrl).not.toHaveBeenCalled()
  })

  it('未知格式与超大媒体只说明下载，不发起预览请求', () => {
    const view = render(<AttachmentPreviewContent item={{ ...image, preview_mime_type: null, image_mime_type: null }} token="test-placeholder" />)
    expect(screen.getByText('此格式暂不支持在线预览')).toBeInTheDocument()
    view.rerender(<AttachmentPreviewContent item={{ ...image, size: 65 * 1024 * 1024 }} token="test-placeholder" />)
    expect(screen.getByText('文件较大，请下载后打开')).toBeInTheDocument()
    expect(fetchAttachmentPreview).not.toHaveBeenCalled()
  })

  it('图片解码失败给出下载提示，避免留下破图', async () => {
    render(<AttachmentPreviewContent item={image} token="test-placeholder" />)
    fireEvent.error(await screen.findByRole('img', { name: image.name }))
    expect(screen.getByRole('alert')).toHaveTextContent('浏览器无法解码')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('列表缩略图可以失败回退，超过 8 MiB 不自动读取原图', async () => {
    const view = render(<AttachmentThumbnail item={image} token="test-placeholder" />)
    await waitFor(() => expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:test-preview'))
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    view.unmount()
    vi.mocked(fetchAttachmentPreview).mockClear()
    render(<AttachmentThumbnail item={{ ...image, size: 9 * 1024 * 1024 }} token="test-placeholder" />)
    expect(fetchAttachmentPreview).not.toHaveBeenCalled()
  })

  it('预览弹窗默认聚焦关闭，保留下载动作与 Escape 关闭', async () => {
    const close = vi.fn(); const download = vi.fn().mockResolvedValue('下载暂不可用，请重试')
    render(<AttachmentPreviewDialog item={image} token="test-placeholder" onClose={close} onDownload={download} downloading={false} />)
    expect(screen.getByRole('button', { name: '关闭附件预览' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '下载文件' }))
    expect(download).toHaveBeenCalledOnce()
    expect(await screen.findByRole('alert')).toHaveTextContent('下载暂不可用，请重试')
    fireEvent(screen.getByRole('dialog', { name: image.name }), new Event('cancel', { bubbles: true, cancelable: true }))
    expect(close).toHaveBeenCalledOnce()
    await screen.findByRole('img', { name: image.name })
  })
})
