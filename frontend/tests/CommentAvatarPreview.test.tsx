import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommentAvatarPreview } from '../src/features/blog/CommentAvatarPreview'
import { previewCommentAvatar } from '../src/lib/api'

vi.mock('../src/lib/api', () => ({ previewCommentAvatar: vi.fn() }))
const createUrl = vi.fn()
const revokeUrl = vi.fn()
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createUrl
    static revokeObjectURL = revokeUrl
  })
  createUrl.mockReturnValue('blob:avatar-test')
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetAllMocks() })
const advance = () => act(async () => { await vi.advanceTimersByTimeAsync(450) })
const preview = (qq: string) => <CommentAvatarPreview qq={qq} token="test-placeholder" />

describe('QQ 头像输入预览', () => {
  it('只查询有效输入，防抖合并修改，图片加载后显示，清空释放资源', async () => {
    vi.mocked(previewCommentAvatar).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    const view = render(preview('alias@qq.com'))
    await advance()
    expect(previewCommentAvatar).not.toHaveBeenCalled()
    view.rerender(preview('12345'))
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    view.rerender(preview('67890@QQ.com'))
    expect(screen.getByRole('status', { name: '正在加载头像' })).toBeInTheDocument()
    await advance()
    expect(previewCommentAvatar).toHaveBeenCalledTimes(1)
    expect(previewCommentAvatar).toHaveBeenCalledWith('test-placeholder', '67890', expect.any(AbortSignal))
    const image = screen.getByAltText('QQ 头像预览')
    expect(image).not.toBeVisible()
    fireEvent.load(image)
    expect(image).toBeVisible()
    view.rerender(preview(''))
    expect(screen.queryByAltText('QQ 头像预览')).not.toBeInTheDocument()
    expect(revokeUrl).toHaveBeenCalledWith('blob:avatar-test')
  })

  it('换邮箱取消旧请求，迟到的响应不能覆盖新头像', async () => {
    let resolveOld!: (blob: Blob) => void
    vi.mocked(previewCommentAvatar).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
    const view = render(preview('12345'))
    await advance()
    const signal = vi.mocked(previewCommentAvatar).mock.calls[0]![2]
    view.rerender(preview('67890'))
    expect(signal.aborted).toBe(true)
    await act(async () => { resolveOld(new Blob(['old'])); await Promise.resolve() })
    expect(createUrl).not.toHaveBeenCalled()
    view.unmount()
    await advance()
    expect(previewCommentAvatar).toHaveBeenCalledTimes(1)
  })

  it('请求失败和图片解码失败均可重试，不触发表单提交', async () => {
    vi.mocked(previewCommentAvatar).mockRejectedValueOnce(new Error('网络失败')).mockResolvedValue(new Blob(['image']))
    render(preview('12345@qq.com'))
    await advance()
    const retry = screen.getByRole('button', { name: '头像加载失败，点击重试' })
    expect(retry).toHaveAttribute('type', 'button')
    fireEvent.click(retry)
    await advance()
    fireEvent.error(screen.getByAltText('QQ 头像预览'))
    fireEvent.click(screen.getByRole('button', { name: '头像加载失败，点击重试' }))
    expect(revokeUrl).toHaveBeenCalledWith('blob:avatar-test')
    await advance()
    fireEvent.load(screen.getByAltText('QQ 头像预览'))
    expect(screen.getByRole('img', { name: 'QQ 头像预览' })).toBeVisible()
    expect(previewCommentAvatar).toHaveBeenCalledTimes(3)
  })
})
