import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCover, ProjectMonitor } from '../src/pages/media/ProjectPreview'
import * as media from '../src/pages/media/api'

const project = { id: 'one', name: '雨后的城市', version: 1, updated_at: '2026-10-01T08:00:00Z' }
const first: media.Asset = { id: 'frame-one', name: '雨夜.png', kind: 'image', mime_type: 'image/png', size: 1024, in_library: false }
const second = { ...first, id: 'frame-two', name: '清晨.png' }
const revoke = vi.fn()

function monitor() {
  return render(<MemoryRouter><ProjectMonitor project={project} loading={false} unavailable={false} onCreate={vi.fn()} /></MemoryRouter>)
}

describe('项目画面监看', () => {
  beforeEach(() => {
    revoke.mockClear()
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:project-preview')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)
    vi.spyOn(media, 'fileBlob').mockResolvedValue(new Blob(['image']))
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('只读取项目图片，切换真实画面并保留画布和素材入口', async () => {
    const request = vi.spyOn(media, 'api').mockResolvedValue({ items: [first, second], total: 2 })
    const { container, unmount } = monitor()
    await waitFor(() => expect(container.querySelector('.media-home-monitor-screen img')).toHaveAttribute('alt', first.name))
    expect(request).toHaveBeenCalledWith('/projects/one/assets?kind=image&page_size=4')
    expect(screen.getByRole('button', { name: `预览画面：${first.name}` })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: `预览画面：${second.name}` }))
    await waitFor(() => expect(container.querySelector('.media-home-monitor-screen img')).toHaveAttribute('alt', second.name))
    expect(screen.getByRole('button', { name: `预览画面：${second.name}` })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: '进入画布' })).toHaveAttribute('href', '/media/projects/one/canvas')
    expect(screen.getByRole('link', { name: '2 张图片' })).toHaveAttribute('href', '/media/projects/one/assets')
    // 缩略图仍订阅同一图片，切换大画面不能提前释放共享地址。
    expect(revoke).not.toHaveBeenCalled()
    expect(media.fileBlob).toHaveBeenCalledTimes(2)
    unmount()
    expect(revoke).toHaveBeenCalledTimes(2)
  })

  it('预览读取失败可以重试，项目与入口仍然可用', async () => {
    vi.spyOn(media, 'api').mockRejectedValueOnce(new Error('不可用')).mockResolvedValue({ items: [first], total: 1 })
    const { container } = monitor()
    expect(await screen.findByText('项目画面暂时无法读取')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '进入画布' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取画面' }))
    await waitFor(() => expect(container.querySelector('.media-home-monitor-screen img')).toHaveAttribute('alt', first.name))
  })

  it('不下载大图片或视频，保留素材库供用户继续操作', async () => {
    vi.spyOn(media, 'api').mockResolvedValue({ items: [{ ...first, size: 9 * 1024 * 1024 }, { ...second, kind: 'video' }], total: 2 })
    monitor()
    expect(await screen.findByText('这个项目还没有可预览的图片')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /打开素材库/ })).toHaveAttribute('href', '/media/projects/one/assets')
    expect(media.fileBlob).not.toHaveBeenCalled()
  })

  it('大画面文件读取失败显示文字并可原位重试', async () => {
    vi.spyOn(media, 'api').mockResolvedValue({ items: [first], total: 1 })
    vi.mocked(media.fileBlob).mockRejectedValueOnce(new Error('不可用')).mockResolvedValue(new Blob(['image']))
    const { container } = monitor()
    expect(await screen.findByText('素材加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(container.querySelector('.media-home-monitor-screen img')).toHaveAttribute('alt', first.name))
  })

  it('离开项目后忽略迟到的预览列表，不再下载文件', async () => {
    let resolve!: (value: { items: media.Asset[]; total: number }) => void
    vi.spyOn(media, 'api').mockReturnValue(new Promise((done) => { resolve = done }))
    const { unmount } = monitor()
    unmount()
    resolve({ items: [first], total: 1 })
    await Promise.resolve()
    expect(media.fileBlob).not.toHaveBeenCalled()
  })

  it('项目封面接近视口才查询，失败时不在导航链接内创建重试按钮', async () => {
    let notify!: IntersectionObserverCallback
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { notify = callback }
      observe() {}
      disconnect() {}
    })
    const request = vi.spyOn(media, 'api').mockResolvedValue({ items: [first], total: 1 })
    vi.mocked(media.fileBlob).mockRejectedValue(new Error('不可用'))
    const { container } = render(<ProjectCover projectId="one" />)
    expect(request).not.toHaveBeenCalled()
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    await waitFor(() => expect(container.querySelector('[aria-label="预览暂不可用"]')).toBeInTheDocument())
    expect(container.querySelector('button')).not.toBeInTheDocument()
  })
})
