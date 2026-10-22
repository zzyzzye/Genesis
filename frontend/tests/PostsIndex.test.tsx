import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, downloadBlogArticles, getTrashedBlogPosts, permanentlyDeleteBlogPost, restoreBlogPost, type BlogPostAdmin } from '../src/lib/api'
import { PostsIndex } from '../src/studio/PostsIndex'

vi.mock('../src/lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('../src/lib/api')>(), downloadBlogArticles: vi.fn(), getTrashedBlogPosts: vi.fn(), permanentlyDeleteBlogPost: vi.fn(), restoreBlogPost: vi.fn() }))
afterEach(() => vi.resetAllMocks())

const posts: BlogPostAdmin[] = Array.from({ length: 45 }, (_, index) => ({
  id: `post-${index}`, slug: `article-${index}`, title: `文章 ${index}`, excerpt: index === 44 ? '特别选题' : '记录想法',
  content_markdown: '正文', cover_image_url: null, category_id: null, category: null,
  status: index === 44 ? 'draft' : 'published', is_featured: false, read_time_minutes: 1, tags: [],
  published_at: null, created_at: '2026-09-01T00:00:00Z', updated_at: `2026-09-${String(index % 28 + 1).padStart(2, '0')}T00:00:00Z`,
  author: { id: 'author', handle: 'genesis', display_name: 'Genesis', avatar_url: null },
}))

function setup(items = posts, path = '/blog/studio/posts') {
  const onOpenPost = vi.fn()
  const onCreatePost = vi.fn()
  const onRestored = vi.fn()
  const router = createMemoryRouter([{ path: '/blog/studio/posts', element: <PostsIndex token="test" onRestored={onRestored} onPendingChange={vi.fn()} posts={items} onCreatePost={onCreatePost} onOpenPost={onOpenPost} /> }], { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return { router, onOpenPost, onCreatePost, onRestored }
}

describe('PostsIndex', () => {
  it('表格选择与编辑互不触发，表头全选仍包含当前页文章', () => {
    const { onOpenPost } = setup(posts.slice(0, 2))
    const table = screen.getByRole('table', { name: '文章管理表格' })
    expect(within(table).getByRole('columnheader', { name: '状态' })).toBeInTheDocument()
    const first = within(table).getByRole('checkbox', { name: '选择文章：文章 0' })
    fireEvent.click(first)
    expect(first).toBeChecked()
    expect(onOpenPost).not.toHaveBeenCalled()
    fireEvent.click(within(table).getByRole('button', { name: /^文章 0/ }))
    expect(onOpenPost).toHaveBeenCalledExactlyOnceWith(posts[0])
    fireEvent.click(within(table).getByRole('checkbox', { name: '选择本页文章' }))
    expect(within(table).getByRole('checkbox', { name: '选择文章：文章 1' })).toBeChecked()
    expect(first).toBeChecked()
    expect(onOpenPost).toHaveBeenCalledOnce()
  })

  it('整库导出不传搜索和分页，单篇导出不触发编辑，失败保留列表并可重试', async () => {
    const { onOpenPost, router } = setup(posts, '/blog/studio/posts?q=特别&status=draft')
    vi.mocked(downloadBlogArticles).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    fireEvent.click(screen.getByRole('button', { name: '导出全部' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络连接中断，请检查网络后重新导出。')
    expect(downloadBlogArticles).toHaveBeenCalledWith('test', { trashed: false }, expect.any(AbortSignal))
    expect(router.state.location.search).toBe('?q=特别&status=draft')
    vi.mocked(downloadBlogArticles).mockResolvedValueOnce()
    fireEvent.click(screen.getByRole('button', { name: '导出 Markdown：文章 44' }))
    expect(await screen.findByText('已开始下载「文章 44」的 Markdown。')).toBeInTheDocument()
    expect(downloadBlogArticles).toHaveBeenLastCalledWith('test', { postId: 'post-44' }, expect.any(AbortSignal))
    expect(onOpenPost).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('导出中同步防重，取消后可重试且旧请求结束不会解锁新请求', async () => {
    let finish!: () => void
    const first = new Promise<void>(resolve => { finish = resolve })
    const second = new Promise<void>(() => {})
    vi.mocked(downloadBlogArticles).mockReturnValueOnce(first).mockReturnValueOnce(second)
    const { router } = setup()
    fireEvent.click(screen.getByRole('button', { name: '导出全部' }))
    fireEvent.click(screen.getByRole('button', { name: '导出全部' }))
    expect(downloadBlogArticles).toHaveBeenCalledTimes(1)
    const firstSignal = vi.mocked(downloadBlogArticles).mock.calls[0]![2]
    expect(screen.getByText('正在准备导出，请稍候…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消下载' }))
    expect(firstSignal.aborted).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '导出全部' }))
    const secondSignal = vi.mocked(downloadBlogArticles).mock.calls[1]![2]
    await act(async () => { finish(); await first })
    expect(screen.getByRole('button', { name: '导出全部' })).toBeDisabled()
    expect(screen.queryByText('已开始下载全部文章 ZIP。')).not.toBeInTheDocument()
    await act(() => router.navigate('/blog/studio/posts?status=published'))
    fireEvent.click(screen.getByRole('button', { name: '取消下载' }))
    expect(secondSignal.aborted).toBe(true)
  })

  it('回收站单独导出，空范围禁用整库导出', async () => {
    vi.mocked(getTrashedBlogPosts).mockResolvedValue([])
    setup([], '/blog/studio/posts?status=trash')
    expect(await screen.findByText('回收站是空的')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出回收站' })).toBeDisabled()
  })

  it('导出完成不会打断用户正在输入的搜索', async () => {
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    vi.mocked(downloadBlogArticles).mockReturnValueOnce(pending)
    setup()
    fireEvent.click(screen.getByRole('button', { name: '导出全部' }))
    const search = screen.getByRole('textbox', { name: '搜索文章' })
    search.focus()
    fireEvent.change(search, { target: { value: '特别' } })
    await act(async () => { finish(); await pending })
    expect(search).toHaveFocus()
    expect(search).toHaveValue('特别')
  })

  it('回收站支持空态、读取失败后重试，恢复成功保留筛选并回调草稿', async () => {
    const trashed = { ...posts[0]!, deleted_at: '2026-10-21T00:00:00Z' }
    vi.mocked(getTrashedBlogPosts).mockRejectedValueOnce(new Error('网络中断')).mockResolvedValueOnce([trashed])
    const restored = { ...trashed, status: 'draft' as const, deleted_at: null }
    vi.mocked(restoreBlogPost).mockResolvedValue(restored)
    const { onRestored, router } = setup(posts, '/blog/studio/posts?status=trash')
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复为草稿' }))
    const dialog = screen.getByRole('dialog', { name: '恢复文章' })
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    fireEvent.click(within(dialog).getByRole('button', { name: '恢复为草稿' }))
    expect(await screen.findByText('回收站是空的')).toBeInTheDocument()
    expect(onRestored).toHaveBeenCalledWith(restored)
    await waitFor(() => expect(screen.getByRole('textbox', { name: '搜索文章' })).toHaveFocus())
    expect(router.state.location.search).toBe('?status=trash')
  })

  it('彻底删除先确认，失败可重试，重复点击只发送一次，版本冲突刷新列表', async () => {
    const trashed = { ...posts[0]!, deleted_at: '2026-10-21T00:00:00Z' }
    vi.mocked(getTrashedBlogPosts).mockResolvedValue([trashed])
    setup(posts, '/blog/studio/posts?status=trash')
    fireEvent.click(await screen.findByRole('button', { name: '彻底删除' }))
    expect(permanentlyDeleteBlogPost).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: '彻底删除文章' })
    vi.mocked(permanentlyDeleteBlogPost).mockRejectedValueOnce(new Error('暂时不可用'))
    fireEvent.click(within(dialog).getByRole('button', { name: '彻底删除' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '彻底删除' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时不可用')
    expect(permanentlyDeleteBlogPost).toHaveBeenCalledTimes(1)
    vi.mocked(permanentlyDeleteBlogPost).mockRejectedValueOnce(new ApiError(409, '文章已恢复'))
    vi.mocked(getTrashedBlogPosts).mockResolvedValue([])
    fireEvent.click(within(dialog).getByRole('button', { name: '彻底删除' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('回收站是空的')).toBeInTheDocument()
  })

  it('分页限制列表长度，筛选回到第一页并保留 URL 查询，文章仍可打开', async () => {
    const { router, onOpenPost } = setup()
    const list = screen.getByRole('region', { name: '文章列表' })
    expect(within(list).getAllByRole('button', { name: /^文章 / })).toHaveLength(40)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(router.state.location.search).toBe('?page=2')
    expect(within(list).getAllByRole('button', { name: /^文章 / })).toHaveLength(5)
    fireEvent.click(screen.getByRole('button', { name: '草稿' }))
    expect(router.state.location.search).toBe('?status=draft')
    expect(within(list).getAllByRole('button', { name: /^文章 / })).toHaveLength(1)
    fireEvent.click(within(list).getByRole('button', { name: /^文章 44/ }))
    expect(onOpenPost).toHaveBeenCalledWith(posts[44])
    await act(() => router.navigate('/blog/studio/posts?q=特别&status=draft'))
    expect(screen.getByRole('textbox', { name: '搜索文章' })).toHaveValue('特别')
    expect(screen.getByRole('button', { name: '草稿' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('无结果可清除筛选，清空搜索后恢复焦点且不写入文章', () => {
    const { router, onOpenPost } = setup(posts, '/blog/studio/posts?q=没有这个词&status=draft')
    expect(screen.getByText('没有匹配的文章')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(router.state.location.search).toBe('')
    expect(screen.getByRole('textbox', { name: '搜索文章' })).toHaveFocus()
    fireEvent.change(screen.getByRole('textbox', { name: '搜索文章' }), { target: { value: '特别' } })
    fireEvent.click(screen.getByRole('button', { name: '清空文章搜索' }))
    expect(screen.getByRole('textbox', { name: '搜索文章' })).toHaveFocus()
    expect(onOpenPost).not.toHaveBeenCalled()
  })

  it('空数据提供创建入口', () => {
    const { onCreatePost } = setup([], '/blog/studio/posts?page=999')
    expect(screen.getByText('还没有文章')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建文章' }))
    expect(onCreatePost).toHaveBeenCalledOnce()
  })

  it('超出范围的页码仍展示最后一页，搜索重置页码', () => {
    const { router } = setup(posts, '/blog/studio/posts?page=999')
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^文章 / })).toHaveLength(5)
    fireEvent.change(screen.getByRole('textbox', { name: '搜索文章' }), { target: { value: '特别' } })
    expect(router.state.location.search).toBe('?q=%E7%89%B9%E5%88%AB')
    expect(screen.getByRole('button', { name: /^文章 44/ })).toBeInTheDocument()
  })
})
