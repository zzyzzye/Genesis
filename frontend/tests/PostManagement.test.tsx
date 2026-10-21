import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, batchArticles, importArticles, previewArticleImport, type BlogPostAdmin } from '../src/lib/api'
import { PostsIndex } from '../src/studio/PostsIndex'
import { PostImportDialog } from '../src/studio/PostImportDialog'
import { PostBatchDialog } from '../src/studio/PostBatchDialog'
import { scheduleInstant } from '../src/studio/postManagement'
import { toEditor, toPayload } from '../src/studio/blogEditor'

vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), batchArticles: vi.fn(), importArticles: vi.fn(), previewArticleImport: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const post: BlogPostAdmin = {
  id: 'post-one', slug: 'one', title: '计划中的文章', excerpt: '摘要', content_markdown: '# 正文', cover_image_url: null,
  category_id: null, category: null, tags: [], status: 'draft', is_featured: false, read_time_minutes: 1,
  published_at: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  author: { id: 'owner', handle: 'genesis', display_name: 'Genesis', avatar_url: null },
}
const receipt = { operation_id: 'receipt', affected_ids: ['new'], skipped: [] }

describe('文章导入与批量管理', () => {
  it('选择本页与所有匹配范围区分，跨页保留快照，筛选后清空选择', async () => {
    const posts = Array.from({ length: 45 }, (_, index) => ({ ...post, id: `post-${index}`, title: `文章 ${index}` }))
    const router = createMemoryRouter([{ path: '/posts', element: <PostsIndex token="test" posts={posts} onRestored={vi.fn()} onPendingChange={vi.fn()} onCreatePost={vi.fn()} onOpenPost={vi.fn()} /> }], { initialEntries: ['/posts'] })
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择本页文章' }))
    expect(screen.getByText('已选 40 篇')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByRole('checkbox', { name: '选择本页文章' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '选择全部 45 篇匹配文章' }))
    expect(screen.getByText('已选 45 篇')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '批量操作' }), { target: { value: 'publish' } })
    const dialog = screen.getByRole('dialog', { name: '发布 45 篇文章' })
    expect(batchArticles).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    fireEvent.change(screen.getByRole('textbox', { name: '搜索文章' }), { target: { value: '文章 1' } })
    expect(screen.getByText('已选 0 篇')).toBeInTheDocument()
    await act(() => router.navigate('/posts?status=scheduled'))
    expect(screen.getByText('没有匹配的文章')).toBeInTheDocument()
  })

  it('导入先预览，冲突不能勾选；网络失败后保留操作标识并安全重试', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined)
    render(<PostImportDialog token="test" onClose={vi.fn()} onComplete={onComplete} onPendingChange={vi.fn()} />)
    const file = new File(['# 正文'], 'article.md', { type: 'text/markdown' })
    fireEvent.change(screen.getByLabelText('选择导入文件'), { target: { files: [file] } })
    vi.mocked(previewArticleImport).mockResolvedValue({ items: [
      { path: 'article.md', title: '新文章', slug: 'article', categories: [], tags: [], issue: null },
      { path: 'old.md', title: '旧文章', slug: 'old', categories: [], tags: [], issue: '同路径文章已存在' },
    ] })
    fireEvent.click(screen.getByRole('button', { name: '预览文件' }))
    const commit = await screen.findByRole('button', { name: '导入 1 篇草稿' })
    expect(screen.getByRole('checkbox', { name: /旧文章/ })).toBeDisabled()
    expect(importArticles).not.toHaveBeenCalled()
    vi.mocked(importArticles).mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(receipt)
    fireEvent.click(commit); fireEvent.click(commit)
    expect(await screen.findByRole('alert')).toHaveTextContent('结果暂未确认')
    expect(importArticles).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '重新选择文件' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重试核对导入结果' }))
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith(receipt))
    expect(vi.mocked(importArticles).mock.calls[0]).toEqual(vi.mocked(importArticles).mock.calls[1])
    expect(importArticles).toHaveBeenCalledWith('test', [file], expect.any(String), ['article.md'])
  })

  it('预览失败保留文件，取消会中断读取，过大的文件不能发送', async () => {
    const onClose = vi.fn()
    const { unmount } = render(<PostImportDialog token="test" onClose={onClose} onComplete={vi.fn()} onPendingChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '预览文件' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请选择 1–20')
    fireEvent.change(screen.getByLabelText('选择导入文件'), { target: { files: [new File(['# A'], 'a.md')] } })
    vi.mocked(previewArticleImport).mockRejectedValueOnce(new Error('解析失败')).mockReturnValueOnce(new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: '预览文件' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('解析失败')
    expect(screen.getByText('a.md')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '预览文件' }))
    const signal = vi.mocked(previewArticleImport).mock.calls[1]![2]
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalled()
    unmount()
    expect(signal.aborted).toBe(true)
  })

  it('定时时间校验聚焦字段，确认携带原版本，冲突后保留输入', async () => {
    render(<PostBatchDialog token="test" action="schedule" posts={[post]} categories={[]} tags={[]} onClose={vi.fn()} onComplete={vi.fn()} onPendingChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '确认定时发布' }))
    const date = screen.getByLabelText('发布时间')
    expect(date).toHaveFocus()
    expect(date).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(date, { target: { value: '2099-10-20T12:30' } })
    vi.mocked(batchArticles).mockRejectedValueOnce(new ApiError(409, '部分文章版本已变更'))
    fireEvent.click(screen.getByRole('button', { name: '确认定时发布' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('部分文章版本已变更')
    expect(date).toHaveValue('2099-10-20T12:30')
    expect(batchArticles).toHaveBeenCalledWith('test', expect.objectContaining({ action: 'schedule', items: [{ id: post.id, expected_updated_at: post.updated_at }], scheduled_at: scheduleInstant('2099-10-20T12:30') }))
    expect(scheduleInstant('2000-01-01T00:00')).toBeNull()
    expect(scheduleInstant('2099-02-30T12:00')).toBeNull()
  })

  it('批量标签可清空，提交失败不改快照；草稿保存保留定时计划，立即发布会清除计划', async () => {
    render(<PostBatchDialog token="test" action="tags" posts={[post]} categories={[]} tags={[{ id: 'tag', name: '工程', slug: 'engineering' }]} onClose={vi.fn()} onComplete={vi.fn()} onPendingChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '工程' }))
    fireEvent.click(screen.getByRole('button', { name: '移除标签 工程' }))
    vi.mocked(batchArticles).mockResolvedValue(receipt)
    fireEvent.click(screen.getByRole('button', { name: '确认设置标签' }))
    await waitFor(() => expect(batchArticles).toHaveBeenCalledWith('test', expect.objectContaining({ tag_ids: [] })))
    const editor = toEditor({ ...post, scheduled_at: '2099-10-20T12:30:00Z' })
    expect(toPayload(editor, [], 'draft').scheduled_at).toBe('2099-10-20T12:30:00Z')
    expect(toPayload(editor, [], 'published').scheduled_at).toBeNull()
  })
})
