import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, Link, MemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArticleComments } from '../src/features/blog/ArticleComments'
import { CommentsWorkspace } from '../src/studio/CommentsWorkspace'
import { accountAuthTokenKey } from '../src/lib/auth'
import { ApiError, getAdminBlogComments, getBlogComments, moderateBlogComment, submitBlogComment, type BlogCommentAdmin } from '../src/lib/api'

vi.mock('../src/lib/api', async (original) => ({
  ...await original<typeof import('../src/lib/api')>(),
  getAdminBlogComments: vi.fn(), getBlogComments: vi.fn(), moderateBlogComment: vi.fn(), submitBlogComment: vi.fn(),
}))
const item: BlogCommentAdmin = { id: 'comment-1', author_name: '测试昵称', content: '<script>不会执行</script>\n保留换行', created_at: '2026-10-11T00:00:00Z', updated_at: '2026-10-11T00:00:00Z', state: 'pending', post_title: '测试文章', post_slug: 'test-post', post_status: 'published' }
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks() })
function reader(loggedIn = true) {
  if (loggedIn) localStorage.setItem(accountAuthTokenKey, 'test-placeholder')
  vi.mocked(getBlogComments).mockResolvedValue({ items: [], total: 0 })
  const router = createMemoryRouter([{ path: '*', element: <><ArticleComments slug="test-post" /><Link to="/blog">离开测试文章</Link></> }], { initialEntries: ['/articles/test-post'] })
  return { ...render(<RouterProvider router={router} />), router }
}

describe('文章评论', () => {
  it('未登录提供返回当前文章的登录入口，空态不影响阅读', async () => {
    reader(false)
    expect(await screen.findByText('还没有公开评论，欢迎留下你的想法。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /登录后参与讨论/ })).toHaveAttribute('href', '/account?returnTo=%2Farticles%2Ftest-post%23comments')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('失败保留输入，相同内容重试使用同一标识；成功待审核，阻止重复提交', async () => {
    reader()
    const field = screen.getByRole('textbox', { name: '写下评论' })
    fireEvent.click(screen.getByRole('button', { name: '提交评论' }))
    expect(submitBlogComment).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: '读者的想法' } })
    vi.mocked(submitBlogComment).mockRejectedValueOnce(new Error('网络中断'))
    fireEvent.click(screen.getByRole('button', { name: '提交评论' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断')
    expect(field).toHaveValue('读者的想法')
    vi.mocked(submitBlogComment).mockResolvedValueOnce({ id: 'comment-1', state: 'pending' })
    const button = screen.getByRole('button', { name: '提交评论' })
    fireEvent.click(button); fireEvent.click(button)
    expect(await screen.findByText('评论已提交，审核通过后会显示。')).toBeInTheDocument()
    expect(submitBlogComment).toHaveBeenCalledTimes(2)
    expect(vi.mocked(submitBlogComment).mock.calls[0]?.[3]).toBe(vi.mocked(submitBlogComment).mock.calls[1]?.[3])
    expect(field).toHaveValue('')
  })

  it('未提交的输入拦截导航；过期登录在新标签页恢复，当前内容保留', async () => {
    const { router } = reader()
    const field = screen.getByRole('textbox', { name: '写下评论' })
    fireEvent.change(field, { target: { value: '不要丢失' } })
    fireEvent.click(screen.getByRole('link', { name: '离开测试文章' }))
    expect(await screen.findByRole('dialog', { name: '评论还未提交' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(field).toHaveValue('不要丢失')
    vi.mocked(submitBlogComment).mockRejectedValueOnce(new ApiError(401, '登录已过期'))
    fireEvent.click(screen.getByRole('button', { name: '提交评论' }))
    expect(await screen.findByRole('link', { name: '重新登录（新标签页）' })).toHaveAttribute('target', '_blank')
    expect(field).toHaveValue('不要丢失')
    fireEvent.click(screen.getByRole('link', { name: '离开测试文章' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃评论并离开' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/blog'))
  })

  it('评论作为纯文本显示，读取失败重试后可继续分页', async () => {
    reader(false)
    vi.mocked(getBlogComments).mockRejectedValueOnce(new Error('离线')).mockResolvedValueOnce({ items: [item], total: 21 }).mockResolvedValueOnce({ items: [{ ...item, id: 'second', content: '后一页' }], total: 2 })
    expect(await screen.findByRole('alert')).toHaveTextContent('评论暂时未能加载')
    fireEvent.click(screen.getByRole('button', { name: '重试加载评论' }))
    expect(await screen.findByText(/<script>不会执行/)).toBeInTheDocument()
    expect(document.querySelector('.article-comments script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '查看更多评论' }))
    expect(await screen.findByText('后一页')).toBeInTheDocument()
    expect(getBlogComments).toHaveBeenLastCalledWith('test-post', 20, expect.any(AbortSignal))
  })
})

describe('评论审核', () => {
  function admin(query = '') {
    vi.mocked(getAdminBlogComments).mockResolvedValue({ items: [item], total: 1 })
    return render(<MemoryRouter initialEntries={['/blog/studio/comments' + query]}><CommentsWorkspace token="test-placeholder" onPendingChange={vi.fn()} navigationBlocked={false} onCancelNavigation={vi.fn()} onConfirmNavigation={vi.fn()} /></MemoryRouter>)
  }
  it('公开前确认，失败保留评论与版本，成功刷新并恢复搜索焦点', async () => {
    admin()
    const list = await screen.findByRole('list', { name: '评论列表' })
    fireEvent.click(within(list).getByRole('button', { name: '公开' }))
    expect(moderateBlogComment).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    vi.mocked(moderateBlogComment).mockRejectedValueOnce(new ApiError(409, '评论状态已更新')).mockResolvedValueOnce({ ...item, state: 'public' })
    fireEvent.click(screen.getByRole('button', { name: '确认公开' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('评论状态已更新')
    fireEvent.click(screen.getByRole('button', { name: '确认公开' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(moderateBlogComment).toHaveBeenLastCalledWith('test-placeholder', item, 'public')
    await waitFor(() => expect(screen.getByRole('textbox', { name: '搜索评论' })).toHaveFocus())
  })
  it('保留 URL 搜索与状态，删除须确认且携带版本', async () => {
    admin('?q=昵称&state=pending&page=1')
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(getAdminBlogComments).toHaveBeenCalledWith('test-placeholder', '昵称', 'pending', 1, expect.any(AbortSignal))
    expect(moderateBlogComment).not.toHaveBeenCalled()
    vi.mocked(moderateBlogComment).mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(moderateBlogComment).toHaveBeenCalledWith('test-placeholder', item, 'delete'))
  })
})
