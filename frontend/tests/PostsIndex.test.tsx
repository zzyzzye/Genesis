import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { BlogPostAdmin } from '../src/lib/api'
import { PostsIndex } from '../src/studio/PostsIndex'

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
  const router = createMemoryRouter([{ path: '/blog/studio/posts', element: <PostsIndex posts={items} onCreatePost={onCreatePost} onOpenPost={onOpenPost} /> }], { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return { router, onOpenPost, onCreatePost }
}

describe('PostsIndex', () => {
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
