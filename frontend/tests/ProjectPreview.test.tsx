import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCover, ProjectCoverDialog } from '../src/pages/media/ProjectPreview'
import * as media from '../src/pages/media/api'
import { clearImageCache } from '../src/pages/media/imagePreview'

const project: media.Project = { id: 'one', name: '雨后的城市', version: 1, updated_at: '2026-10-01T08:00:00Z' }
const first: media.Asset = { id: 'frame-one', name: '雨夜.png', kind: 'image', mime_type: 'image/png', size: 1024, in_library: false }
const second = { ...first, id: 'frame-two', name: '清晨.png' }

describe('作品封面', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:project-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(vi.fn())
    vi.spyOn(media, 'fileBlob').mockResolvedValue(new Blob(['image']))
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  })
  afterEach(() => { act(() => clearImageCache()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('优先读取指定封面，更换封面后不继续展示旧图', async () => {
    const request = vi.spyOn(media, 'api').mockImplementation(path => Promise.resolve(path === '/assets/frame-one' ? first : second))
    const { container, rerender } = render(<ProjectCover project={{ ...project, cover_asset_id: first.id }} />)
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('alt', first.name))
    rerender(<ProjectCover project={{ ...project, cover_asset_id: second.id }} />)
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('alt', second.name))
    expect(request.mock.calls.map(([path]) => path)).toEqual(['/assets/frame-one', '/assets/frame-two'])
    expect(media.fileBlob).toHaveBeenCalledWith({ id: second.id }, expect.any(AbortSignal), false)
  })

  it('未指定封面时使用作品图片，没有图片时保留作品名称', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ items: [] })
    render(<ProjectCover project={project} />)
    expect(await screen.findByText('尚未设置封面')).toBeInTheDocument()
    expect(screen.getByText(project.name)).toBeInTheDocument()
    expect(request).toHaveBeenCalledWith('/projects/one/assets?kind=image&page_size=1')
    expect(media.fileBlob).not.toHaveBeenCalled()
  })

  it('接近视口才加载，失败时不在导航链接内嵌套重试按钮', async () => {
    let notify!: IntersectionObserverCallback
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback }
      observe() {}
      disconnect() {}
    })
    const request = vi.spyOn(media, 'api').mockResolvedValue({ items: [first] })
    vi.mocked(media.fileBlob).mockRejectedValue(new Error('不可用'))
    const { container } = render(<ProjectCover project={project} />)
    expect(request).not.toHaveBeenCalled()
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    await waitFor(() => expect(container).toHaveTextContent('素材加载失败'))
    expect(container.querySelector('button')).not.toBeInTheDocument()
  })

  it('保存失败保留选择器，重试成功返回持久封面', async () => {
    const saved = { ...project, cover_asset_id: second.id }
    const request = vi.spyOn(media, 'api').mockImplementation((_path, method) => method === 'PUT' ? Promise.reject(new Error('设置失败，请重试')) : Promise.resolve({ items: [second], total: 1 }))
    const onSaved = vi.fn()
    render(<ProjectCoverDialog project={project} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.click(await screen.findByRole('button', { name: '设为封面' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('设置失败，请重试')
    expect(onSaved).not.toHaveBeenCalled()
    request.mockResolvedValueOnce(saved)
    fireEvent.click(screen.getByRole('button', { name: '设为封面' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(request).toHaveBeenLastCalledWith('/projects/one/cover', 'PUT', { asset_id: second.id })
  })

  it('上传自定义图片后直接设为封面，上传过程中保持弹窗', async () => {
    let finishUpload!: (asset: media.Asset) => void
    const upload = vi.spyOn(media, 'upload').mockReturnValue(new Promise(resolve => { finishUpload = resolve }))
    const saved = { ...project, cover_asset_id: second.id }
    const request = vi.spyOn(media, 'api').mockImplementation((_path, method) => Promise.resolve(method === 'PUT' ? saved : { items: [], total: 0 }))
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<ProjectCoverDialog project={project} onClose={onClose} onSaved={onSaved} />)
    const file = new File(['cover'], '自定义封面.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('上传自定义封面', { selector: 'input' }), { target: { files: [file] } })
    expect(screen.getByRole('button', { name: '上传自定义封面' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '关闭封面选择' }))
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索素材' }), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    act(() => finishUpload(second))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(upload).toHaveBeenCalledWith('/projects/one/assets', file, expect.any(Function))
    expect(request).toHaveBeenLastCalledWith('/projects/one/cover', 'PUT', { asset_id: second.id })
  })

  it('自定义封面上传成功而保存失败时，重试复用已上传图片', async () => {
    const upload = vi.spyOn(media, 'upload').mockResolvedValue(second)
    let attempts = 0
    const saved = { ...project, cover_asset_id: second.id }
    vi.spyOn(media, 'api').mockImplementation((_path, method) => {
      if (method !== 'PUT') return Promise.resolve({ items: [], total: 0 })
      return ++attempts === 1 ? Promise.reject(new Error('封面保存失败')) : Promise.resolve(saved)
    })
    const onSaved = vi.fn()
    render(<ProjectCoverDialog project={project} onClose={vi.fn()} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('上传自定义封面', { selector: 'input' }), { target: { files: [new File(['image'], '封面.png', { type: 'image/png' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('封面保存失败')
    fireEvent.click(screen.getByRole('button', { name: '重试设置' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(attempts).toBe(2)
  })

  it('拒绝非图片文件，保留重新选择入口', async () => {
    vi.spyOn(media, 'api').mockResolvedValue({ items: [], total: 0 })
    const upload = vi.spyOn(media, 'upload')
    render(<ProjectCoverDialog project={project} onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('上传自定义封面', { selector: 'input' }), { target: { files: [new File(['video'], '视频.mp4', { type: 'video/mp4' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('请选择 JPG、PNG、WebP、GIF 或 AVIF 图片')
    expect(upload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '上传自定义封面' })).toBeEnabled()
  })
})
