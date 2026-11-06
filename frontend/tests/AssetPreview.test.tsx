import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetPreview } from '../src/pages/media/AssetPreview'
import * as media from '../src/pages/media/api'
import { accountAuthTokenKey } from '../src/lib/auth'
import { clearImageCache } from '../src/pages/media/imagePreview'

const audio: media.Asset = { id:'audio', name:'雨声.wav', kind:'audio', mime_type:'audio/wav', size:32, in_library:false }
const createObjectURL = vi.fn(() => 'blob:preview')
const revokeObjectURL = vi.fn()

describe('素材播放器', () => {
  // 分块转换耗时不属于交互验收，先加载真实播放器模块。
  beforeAll(async () => { await import('../src/pages/media/MediaPlayer') })
  beforeEach(() => {
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL)
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(media, 'fileBlob').mockResolvedValue(new Blob(['preview']))
    vi.spyOn(media, 'playbackUrl').mockResolvedValue('/api/v1/media/assets/audio/stream')
  })
  afterEach(() => { cleanup(); clearImageCache(); localStorage.clear(); vi.restoreAllMocks() })

  it('成品与缩略图独立读取，预览关闭后仍保留缓存', async () => {
    const asset = { ...audio, id:'shared-image', kind:'image' as const }
    const result = render(<AssetPreview asset={asset} />)
    await screen.findByRole('img', { name:asset.name })
    const reference = render(<AssetPreview asset={asset} thumbnail passive />)
    await waitFor(() => expect(screen.getAllByRole('img', { name:asset.name })).toHaveLength(2))
    expect(media.fileBlob).toHaveBeenCalledTimes(2)
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    result.unmount()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    reference.unmount()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('同尺寸预览合并请求，关闭其中一个不会取消加载，会话切换重新读取', async () => {
    let finish!: (blob: Blob) => void
    vi.mocked(media.fileBlob).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const asset = { ...audio, id:'pending-image', kind:'image' as const }
    const result = render(<AssetPreview asset={asset} />)
    const reference = render(<AssetPreview asset={asset} passive />)
    expect(media.fileBlob).toHaveBeenCalledTimes(1)
    const signal = vi.mocked(media.fileBlob).mock.calls[0]![1]!
    reference.unmount()
    expect(signal.aborted).toBe(false)
    await act(async () => { finish(new Blob(['image'])); await Promise.resolve() })
    await screen.findByRole('img', { name:asset.name })
    localStorage.setItem(accountAuthTokenKey, 'synthetic-next-session')
    result.rerender(<AssetPreview asset={asset} />)
    expect(media.fileBlob).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('img', { name:asset.name })).not.toBeInTheDocument()
  })

  it('素材显示名称与下载文件名同源，下载保留服务端补齐的类型后缀', async () => {
    render(<AssetPreview asset={{ ...audio, kind:'image', name:'烧烤成品', download_name:'烧烤成品.png', mime_type:'image/png' }} controls />)
    expect(await screen.findByRole('link', { name:'下载原文件' })).toHaveAttribute('download', '烧烤成品.png')
    expect(screen.getByRole('img', { name:'烧烤成品' })).toBeInTheDocument()
  })

  it('音频使用中文播放控件和分段地址，操作不触发节点拖动', async () => {
    const onPointerDown = vi.fn()
    const { container, unmount } = render(<div onPointerDown={onPointerDown}><AssetPreview asset={audio} controls /></div>)
    const play = await screen.findByRole('button', { name:'播放' })
    expect(screen.getByRole('group', { name:'音频播放器：雨声.wav' })).toBeInTheDocument()
    expect(container.querySelector('audio')).not.toHaveAttribute('controls')
    fireEvent.pointerDown(play)
    expect(onPointerDown).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name:'下载原文件' })).toHaveAttribute('href', '/api/v1/media/assets/audio/stream?download=true')
    expect(container.querySelector('audio')).toHaveAttribute('crossorigin', 'use-credentials')
    expect(media.fileBlob).not.toHaveBeenCalled()
    unmount()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('解码失败保留下载和重试，重试重新读取素材并恢复播放器', async () => {
    const { container } = render(<AssetPreview asset={audio} controls />)
    await screen.findByRole('button', { name:'播放' })
    fireEvent.error(container.querySelector('audio')!)
    expect(await screen.findByText('素材播放失败，请重试或下载原文件')).toBeInTheDocument()
    expect(screen.getByRole('link', { name:'下载原文件' })).toHaveAttribute('download', '雨声.wav')
    fireEvent.click(screen.getByRole('button', { name:'重试' }))
    await screen.findByRole('button', { name:'播放' })
    expect(media.playbackUrl).toHaveBeenCalledTimes(2)
  })

  it('视频缩略图静音、不自动播放，不加载完整播放器或下载操作', async () => {
    const video = { ...audio, id:'video', name:'雨夜.webm', kind:'video' as const, mime_type:'video/webm' }
    const { container } = render(<AssetPreview asset={video} thumbnail />)
    await screen.findByLabelText('视频参考：雨夜.webm')
    const element = container.querySelector('video')!
    expect(element.muted).toBe(true)
    expect(element.autoplay).toBe(false)
    expect(element.controls).toBe(false)
    expect(element.playsInline).toBe(true)
    expect(media.fileBlob).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name:'播放' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('挂载前已失败的媒体也显示错误，避免空播放器无法重试', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'error')
    Object.defineProperty(HTMLMediaElement.prototype, 'error', { configurable: true, get: () => ({ code: 4, message: '加载失败' }) })
    try {
      render(<AssetPreview asset={{ ...audio, kind:'video' }} controls />)
      expect(await screen.findByText('素材播放失败，请重试或下载原文件')).toBeInTheDocument()
      expect(screen.getByRole('button', { name:'重试' })).toBeInTheDocument()
    } finally {
      if (original) Object.defineProperty(HTMLMediaElement.prototype, 'error', original)
      else Reflect.deleteProperty(HTMLMediaElement.prototype, 'error')
    }
  })

  it('加载期间卸载保留在途请求供再次打开复用', async () => {
    let resolve!: (blob: Blob) => void
    vi.mocked(media.fileBlob).mockReturnValue(new Promise((done) => { resolve = done }))
    const { unmount } = render(<AssetPreview asset={{ ...audio, kind:'image' }} controls />)
    unmount()
    resolve(new Blob(['preview']))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1))
  })

  it('素材改名不重新授权或下载，换素材立即清除旧播放器', async () => {
    const { container, rerender } = render(<AssetPreview asset={audio} controls />)
    await screen.findByRole('button', { name:'播放' })
    rerender(<AssetPreview asset={{ ...audio, name:'新名称' }} controls />)
    expect(media.playbackUrl).toHaveBeenCalledTimes(1)
    vi.mocked(media.playbackUrl).mockReturnValue(new Promise(() => {}))
    rerender(<AssetPreview asset={{ ...audio, id:'other' }} controls />)
    expect(container.querySelector('audio')).toBeNull()
    expect(screen.getByText('加载素材…')).toBeInTheDocument()
  })

  it('授权失败可原位重试，卸载取消未完成请求', async () => {
    vi.mocked(media.playbackUrl).mockRejectedValueOnce(new Error('expired'))
    const { unmount } = render(<AssetPreview asset={audio} controls />)
    expect(await screen.findByText('素材加载失败')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name:'重试' }))
    await screen.findByRole('button', { name:'播放' })
    const signal = vi.mocked(media.playbackUrl).mock.calls.at(-1)![1]!
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
