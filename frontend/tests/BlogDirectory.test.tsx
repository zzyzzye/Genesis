import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlogDirectory } from '../src/features/blog/BlogDirectory'
import { getPublicBlogLinks, getBlogPosts, getPublicBlogTags, type BlogPostPreview } from '../src/lib/api'

vi.mock('../src/lib/api', () => ({ getBlogPosts: vi.fn(), getPublicBlogTags: vi.fn(), getPublicBlogLinks: vi.fn() }))

const post: BlogPostPreview = { id: 'one', slug: 'engineering', title: '工程实践', excerpt: '模块与写作', cover_image_url: null, category: null, is_featured: true, read_time_minutes: 3, published_at: '2026-09-02T00:00:00Z', author: { id: 'author', handle: 'genesis', display_name: 'Genesis', avatar_url: null }, tags: [{ id: 'tag', slug: 'engineering', name: '工程' }] }

function Location() { const location = useLocation(); return <output aria-label="当前路径">{location.pathname}{location.search}</output> }
function open(path = '/blog') { return render(<MemoryRouter initialEntries={[path]}><BlogDirectory /><Location /></MemoryRouter>) }

describe('公开博客目录', () => {
  beforeEach(() => {
    vi.mocked(getBlogPosts).mockResolvedValue({ items: [post], total: 1 })
    vi.mocked(getPublicBlogTags).mockResolvedValue([{ id: 'tag', slug: 'engineering', name: '工程', post_count: 14 }])
    vi.mocked(getPublicBlogLinks).mockResolvedValue({ items: [], total: 0 })
  })
  afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals() })

  it('使用全站标签计数与 URL 筛选，收起侧栏仍保留导航名称', async () => {
    open()
    expect(await screen.findByRole('link', { name: '阅读 工程实践' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '筛选标签 工程' })).toHaveTextContent('14')
    fireEvent.click(screen.getByRole('button', { name: '收起博客侧栏' }))
    expect(screen.getByRole('link', { name: '我的账户' })).toHaveAttribute('href', '/account')
    expect(screen.queryByRole('link', { name: '页面' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '工程' }))
    await waitFor(() => expect(getBlogPosts).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined, { q: '', tag: 'engineering', offset: undefined }))
    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/blog?tag=engineering')
  })

  it('分页查询带偏移量，越界时返回最后一页', async () => {
    vi.mocked(getBlogPosts).mockResolvedValue({ items: [post], total: 25 })
    open('/blog?q=工程&tag=engineering&page=99')
    expect(await screen.findByText('第 3 / 3 页')).toBeInTheDocument()
    expect(getBlogPosts).toHaveBeenLastCalledWith(expect.any(AbortSignal), undefined, { q: '工程', tag: 'engineering', offset: 24 })
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    expect(await screen.findByText('第 2 / 3 页')).toBeInTheDocument()
  })

  it('失败可重试，空搜索结果可恢复全部文章', async () => {
    vi.mocked(getBlogPosts).mockRejectedValueOnce(new Error('暂时不可用')).mockResolvedValueOnce({ items: [], total: 0 })
    open('/blog?q=没有')
    expect(await screen.findByRole('alert')).toHaveTextContent('文章暂时未能加载')
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('没有匹配的文章')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看全部文章' }))
    expect(await screen.findByRole('link', { name: '阅读 工程实践' })).toBeInTheDocument()
    expect(screen.getByLabelText('当前路径')).toHaveTextContent('/blog')
  })

  it('搜索支持输入法组合、查询、清空和焦点恢复', async () => {
    open()
    await screen.findByRole('link', { name: '阅读 工程实践' })
    const trigger = screen.getByRole('button', { name: '搜索文章' })
    trigger.focus(); fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '搜索文章' })
    const input = within(dialog).getByRole('textbox', { name: '搜索文章关键词' })
    expect(input).toHaveFocus()
    const requests = vi.mocked(getBlogPosts).mock.calls.length
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: '工程' } })
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(getBlogPosts).toHaveBeenCalledTimes(requests)
    fireEvent.compositionEnd(input)
    expect(await within(dialog).findByRole('link', { name: '工程实践' })).toBeInTheDocument()
    expect(getBlogPosts).toHaveBeenLastCalledWith(expect.any(AbortSignal), 8, { q: '工程' })
    fireEvent.click(within(dialog).getByRole('button', { name: '清空文章搜索' }))
    expect(input).toHaveValue(''); expect(input).toHaveFocus()
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭文章搜索' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('手机导航使用模态菜单，选中标签后关闭并保留筛选', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    open()
    await screen.findByRole('button', { name: '筛选标签 工程' })
    fireEvent.click(screen.getByRole('button', { name: '打开博客导航' }))
    const dialog = screen.getByRole('dialog', { name: '博客导航菜单' })
    fireEvent.click(within(dialog).getByRole('button', { name: '筛选标签 工程' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('当前路径')).toHaveTextContent('tag=engineering')
  })
})
