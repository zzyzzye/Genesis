import { afterEach, describe, expect, it, vi } from 'vitest'

import { downloadBlogArticles } from '../src/lib/api'
import { downloadBlob } from '../src/lib/download'

vi.mock('../src/lib/download', () => ({ downloadBlob: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.mocked(downloadBlob).mockReset() })

describe('文章导出下载', () => {
  it('只在取得完整文件后下载，鉴权放在请求头，文件名沿用服务端回执', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('# 中文正文', { headers: { 'Content-Disposition': 'attachment; filename="saved-post.md"' } }))
    const signal = new AbortController().signal
    await downloadBlogArticles('test-placeholder', { postId: 'article/id' }, signal)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/admin/blog/posts/article%2Fid/export', { headers: { Authorization: 'Bearer test-placeholder' }, signal })
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('saved-post.md')
    expect(await vi.mocked(downloadBlob).mock.calls[0]![0].text()).toBe('# 中文正文')
    fetcher.mockResolvedValueOnce(new Response('zip', { headers: { 'Content-Disposition': 'attachment; filename="genesis-trash.zip"' } }))
    await downloadBlogArticles('test-placeholder', { trashed: true }, signal)
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/admin/blog/posts/export?trashed=true', expect.objectContaining({ signal }))
    expect(vi.mocked(downloadBlob).mock.calls[1]?.[1]).toBe('genesis-trash.zip')
    expect(await vi.mocked(downloadBlob).mock.calls[1]![0].text()).toBe('zip')
  })

  it('错误和已取消请求不会触发下载，异常文件名使用安全后备名称', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"detail":"文章不存在"}', { status: 404 }))
    const controller = new AbortController()
    await expect(downloadBlogArticles('test-placeholder', { postId: 'missing' }, controller.signal)).rejects.toThrow('文章不存在')
    expect(downloadBlob).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(new Response('late'))
    controller.abort()
    await expect(downloadBlogArticles('test-placeholder', { trashed: false }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(downloadBlob).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(new Response('content', { headers: { 'Content-Disposition': 'attachment; filename="../../escape.html"' } }))
    await downloadBlogArticles('test-placeholder', { postId: 'safe' }, new AbortController().signal)
    expect(vi.mocked(downloadBlob).mock.calls[0]?.[1]).toBe('article.md')
    expect(await vi.mocked(downloadBlob).mock.calls[0]![0].text()).toBe('content')
  })
})
