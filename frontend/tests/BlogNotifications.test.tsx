import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlogNotifications } from '../src/features/blog/BlogNotifications'

afterEach(() => vi.restoreAllMocks())
describe('回复通知', () => {
  it('标记失败保留未读，重试成功后移除未读并提供评论定位链接', async () => {
    let marks = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
      if (init?.method === 'PUT') { marks++; return Promise.resolve(new Response(marks === 1 ? JSON.stringify({ detail: '失败' }) : null, { status: marks === 1 ? 503 : 204 })) }
      return Promise.resolve(new Response(JSON.stringify({ items: [{ id: 'note', post_title: '测试文章', post_slug: 'test', created_at: '2026-11-01T00:00:00Z', read_at: null, comment: { id: 'reply', author_name: '作者', content: '回复内容', created_at: '2026-11-01T00:00:00Z' } }], total: 1, unread: 1 })))
    })
    render(<MemoryRouter><BlogNotifications token="test" /></MemoryRouter>)
    expect(await screen.findByText('1 条未读')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看《测试文章》/ })).toHaveAttribute('href', '/articles/test?comment=reply#comments')
    fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('未能标记已读')
    expect(screen.getByText('1 条未读')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '标为已读' }))
    expect(await screen.findByText('查看评论收到的回复')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '标为已读' })).not.toBeInTheDocument()
  })
  it('空态与加载失败区分，重试重新读取', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('离线')).mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, unread: 0 })))
    render(<MemoryRouter><BlogNotifications token="test" /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('通知暂时未能加载')
    expect(screen.queryByText(/还没有回复通知/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByText(/还没有回复通知/)).toBeInTheDocument()
  })
})
