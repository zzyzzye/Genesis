import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArticleHistory } from '../src/studio/ArticleHistory'
import { createEmptyEditor } from '../src/studio/blogEditor'
import { getRevision, getRevisions } from '../src/lib/blogHistory'

vi.mock('../src/lib/blogHistory', () => ({ getRevision: vi.fn(), getRevisions: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const item = { id: 'revision-1', title: '旧标题', version: '2026-11-01T12:00:00Z' }
describe('文章历史', () => {
  it('先比较再确认载入，保留当前路径、并发版本和发布状态，不写服务器', async () => {
    vi.mocked(getRevisions).mockResolvedValue({ items: [item], total: 1 })
    vi.mocked(getRevision).mockResolvedValue({ ...item, payload: { slug: 'old-path', title: '旧标题', excerpt: '旧摘要', content_markdown: '旧正文', cover_image_url: null, category_ids: ['removed-category'], tags: [{ name: '删除标签', slug: 'removed-tag' }], is_featured: false, read_time_minutes: 1 } })
    const editor = { ...createEmptyEditor(), id: 'post-1', title: '当前标题', slug: 'current-path', updatedAt: 'current-version', status: 'published' as const, scheduledAt: null }
    const onApply = vi.fn()
    render(<ArticleHistory token="test" editor={editor} categories={[]} tags={[]} onApply={onApply} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /旧标题/ }))
    expect(await screen.findByText('旧正文')).toBeInTheDocument()
    expect(screen.getByText('当前标题')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '载入此版本' }))
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认载入编辑器' }))
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ title: '旧标题', contentMarkdown: '旧正文', slug: 'current-path', updatedAt: 'current-version', status: 'published', categoryIds: [], selectedTagSlugs: [] }))
  })
  it('版本读取失败可重试，失败时不能载入；空历史给出说明', async () => {
    vi.mocked(getRevisions).mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue({ items: [], total: 0 })
    render(<ArticleHistory token="test" editor={{ ...createEmptyEditor(), id: 'post' }} categories={[]} tags={[]} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败')
    expect(screen.getByRole('button', { name: '载入此版本' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(screen.getByText(/还没有历史版本/)).toBeInTheDocument())
  })
})
