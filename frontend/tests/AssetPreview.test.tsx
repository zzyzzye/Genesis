import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetPreview } from '../src/pages/media/AssetPreview'
import * as media from '../src/pages/media/api'

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
  })
  afterEach(() => vi.restoreAllMocks())

  it('音频使用中文播放控件，操作不触发节点拖动，卸载释放私有文件地址', async () => {
    const onPointerDown = vi.fn()
    const { container, unmount } = render(<div onPointerDown={onPointerDown}><AssetPreview asset={audio} controls /></div>)
    const play = await screen.findByRole('button', { name:'播放' })
    expect(screen.getByRole('group', { name:'音频播放器：雨声.wav' })).toBeInTheDocument()
    expect(container.querySelector('audio')).not.toHaveAttribute('controls')
    fireEvent.pointerDown(play)
    expect(onPointerDown).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name:'下载原文件' })).toHaveAttribute('href', 'blob:preview')
    unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
  })

  it('解码失败保留下载和重试，重试重新读取素材并恢复播放器', async () => {
    const { container } = render(<AssetPreview asset={audio} controls />)
    await screen.findByRole('button', { name:'播放' })
    fireEvent.error(container.querySelector('audio')!)
    expect(await screen.findByText('浏览器不支持预览，可下载原文件')).toBeInTheDocument()
    expect(screen.getByRole('link', { name:'下载原文件' })).toHaveAttribute('download', '雨声.wav')
    fireEvent.click(screen.getByRole('button', { name:'重试' }))
    await screen.findByRole('button', { name:'播放' })
    expect(media.fileBlob).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')
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
    expect(screen.queryByRole('button', { name:'播放' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('加载期间卸载不再创建文件地址', async () => {
    let resolve!: (blob: Blob) => void
    vi.mocked(media.fileBlob).mockReturnValue(new Promise((done) => { resolve = done }))
    const { unmount } = render(<AssetPreview asset={audio} controls />)
    unmount()
    resolve(new Blob(['preview']))
    await waitFor(() => expect(createObjectURL).not.toHaveBeenCalled())
  })
})
