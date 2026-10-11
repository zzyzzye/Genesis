import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Home } from '../src/pages/home/Home'
import { getBlogPosts, type BlogPostPreview } from '../src/lib/api'

vi.mock('../src/lib/api', () => ({ getBlogPosts: vi.fn() }))
const article: BlogPostPreview = { id: 'one', slug: 'home-reading', title: '给想法留一个地方', excerpt: '从每天的记录开始。', cover_image_url: null, is_featured: false, read_time_minutes: 3, published_at: '2026-10-10T00:00:00Z', author: { id: 'author', handle: 'author', display_name: '作者', avatar_url: null }, category: null, tags: [] }
afterEach(() => vi.resetAllMocks())
function setup() { return render(<MemoryRouter><Home /></MemoryRouter>) }

describe('首页文章选读', () => {
  it('有界读取真实摘要，链接进入公开正文，离开时停止读取', async () => {
    vi.mocked(getBlogPosts).mockResolvedValue({ items: [article], total: 1 })
    const view = setup()
    expect(screen.getByRole('status')).toHaveTextContent('正在读取文章')
    expect(await screen.findByRole('link', { name: '阅读 给想法留一个地方' })).toHaveAttribute('href', '/articles/home-reading')
    expect(screen.getByText('3 分钟阅读')).toBeInTheDocument()
    expect(screen.getByText(article.excerpt)).toBeInTheDocument()
    expect(getBlogPosts).toHaveBeenCalledWith(expect.any(AbortSignal), 3)
    const signal = vi.mocked(getBlogPosts).mock.calls[0]![0]!
    view.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('没有公开文章时明确说明，三个模块和账户仍可进入', async () => {
    vi.mocked(getBlogPosts).mockResolvedValue({ items: [], total: 0 })
    setup()
    expect(await screen.findByText('还没有发布的文章，之后再来看看。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '进入博客' })).toHaveAttribute('href', '/blog')
    expect(screen.getByRole('link', { name: '查看工具箱' })).toHaveAttribute('href', '/toolbox')
    expect(screen.getByRole('link', { name: '进入影音' })).toHaveAttribute('href', '/media')
    expect(screen.getByRole('link', { name: '账户' })).toHaveAttribute('href', '/account')
    expect(screen.getByText('筹备中')).toBeInTheDocument()
  })

  it('失败保留入口，手动重试可以恢复文章', async () => {
    vi.mocked(getBlogPosts).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce({ items: [article], total: 1 })
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法读取文章')
    expect(screen.getByRole('link', { name: '进入博客' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载文章' }))
    expect(await screen.findByRole('link', { name: '阅读 给想法留一个地方' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
