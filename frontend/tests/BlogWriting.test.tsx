import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { blogDraftKey, createEmptyEditor } from '../src/studio/blogEditor'

const author = { id: 'writing-author', handle: 'writer', display_name: '写作者', avatar_url: null, role: 'owner', bio: '' }
const savedPost = {
  id: 'writing-post', title: '已发布文章', slug: 'writing-post', excerpt: '摘要', content_markdown: '# 文章正文',
  status: 'published', is_featured: false, read_time_minutes: 1, category_id: null, category: null,
  cover_image_url: null, tags: [], author, published_at: '2026-10-01T00:00:00Z',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
}

function setup(path: string, postList: unknown[] = []) {
  localStorage.setItem('genesis-studio-token', 'writing-test-token')
  window.history.pushState({}, '', path)
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let data: unknown = []
    if (url.endsWith('/auth/me')) data = author
    if (url.endsWith('/admin/blog/posts')) data = postList
    if (init?.method === 'PUT' || init?.method === 'POST') {
      const payload = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>
      data = { ...savedPost, ...payload, updated_at: '2026-10-08T00:00:00Z' }
    }
    return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })
  return { view: render(<App />), fetchMock }
}

describe('可靠博客写作流程', () => {
  afterEach(() => { window.history.pushState({}, '', '/'); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks() })

  it('未保存的新文章可预览、返回编辑，并在离开时确认', async () => {
    setup('/blog/studio/posts/new/edit')
    const title = await screen.findByRole('textbox', { name: '文章标题' })
    fireEvent.change(title, { target: { value: '预览验收' } })
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(await screen.findByRole('heading', { name: '预览验收' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/blog/studio/posts/new')
    fireEvent.click(screen.getByRole('button', { name: '编辑文章' }))
    expect(await screen.findByRole('textbox', { name: '文章标题' })).toHaveValue('预览验收')
    fireEvent.click(screen.getByRole('button', { name: '← 返回文章列表' }))
    const dialog = await screen.findByRole('dialog', { name: '还有未保存的内容' })
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.getByRole('textbox', { name: '文章标题' })).toHaveValue('预览验收')
  })

  it('恢复由作者决定，恢复前不会用旧内容覆盖当前页面', async () => {
    const editor = { ...createEmptyEditor(), title: '刷新前的草稿', contentMarkdown: '# 待恢复正文' }
    sessionStorage.setItem(blogDraftKey(author.id, null), JSON.stringify({ editor, savedAt: Date.now() }))
    setup('/blog/studio/posts/new/edit')
    expect(await screen.findByRole('button', { name: '恢复内容' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '文章标题' })).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: '恢复内容' }))
    expect(screen.getByRole('textbox', { name: '文章标题' })).toHaveValue('刷新前的草稿')
    expect(await screen.findByRole('heading', { name: '待恢复正文' })).toBeInTheDocument()
  })

  it('空白草稿可保存，空白内容不能进入发布确认', async () => {
    const { fetchMock } = setup('/blog/studio/posts/new/edit')
    await screen.findByRole('textbox', { name: '文章标题' })
    fireEvent.click(screen.getByRole('button', { name: '发布' }))
    expect(screen.getByText('发布前请填写标题和正文。')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '发布前检查' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(await screen.findByText('草稿已保存到站点。')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/blog/studio/posts/writing-post/edit')
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(JSON.parse(typeof call?.[1]?.body === 'string' ? call[1].body : '{}')).toMatchObject({ status: 'draft', title: '未命名文章', content_markdown: '' })
  })

  it('更新发布先审阅，保留发布状态并携带版本，只提交一次', async () => {
    const { fetchMock } = setup('/blog/studio/posts/writing-post/edit', [savedPost])
    fireEvent.change(await screen.findByRole('textbox', { name: '文章标题' }), { target: { value: '修改后的文章' } })
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更新发布' }))
    const dialog = await screen.findByRole('dialog', { name: '更新已发布文章' })
    expect(dialog).toHaveTextContent('修改后的文章')
    const confirm = within(dialog).getByRole('button', { name: '确认更新发布' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('已发布到站点。')).toBeInTheDocument()
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT')
    expect(writes).toHaveLength(1)
    const body = writes[0]?.[1]?.body
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toMatchObject({ status: 'published', expected_updated_at: savedPost.updated_at })
    expect(sessionStorage.getItem(blogDraftKey(author.id, savedPost.id))).toBeNull()
  })

  it('保存冲突保留输入，核对最新版本后可继续编辑并保存', async () => {
    const { fetchMock } = setup('/blog/studio/posts/writing-post/edit', [savedPost])
    fireEvent.change(await screen.findByRole('textbox', { name: '文章标题' }), { target: { value: '本地修改' } })
    let writeCount = 0
    const latest = { ...savedPost, title: '站点上的新标题', content_markdown: '站点的新正文', updated_at: '2026-10-08T00:00:00Z' }
    fetchMock.mockImplementation((input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (init?.method === 'PUT') {
        writeCount += 1
        if (writeCount === 1) return Promise.resolve(new Response(JSON.stringify({ detail: '文章版本冲突' }), { status: 409 }))
        const payload = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>
        return Promise.resolve(new Response(JSON.stringify({ ...latest, ...payload }), { status: 200 }))
      }
      if (url.endsWith('/admin/blog/posts/writing-post')) return Promise.resolve(new Response(JSON.stringify(latest), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify(url.endsWith('/auth/me') ? author : []), { status: 200 }))
    })
    fireEvent.click(screen.getByRole('button', { name: '更新发布' }))
    const dialog = await screen.findByRole('dialog', { name: '更新已发布文章' })
    fireEvent.click(within(dialog).getByRole('button', { name: '确认更新发布' }))
    expect(await screen.findByText(/请求失败：HTTP 409/)).toHaveTextContent('文章版本冲突')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '文章标题' })).toHaveValue('本地修改')
    expect(sessionStorage.getItem(blogDraftKey(author.id, savedPost.id))).toContain('本地修改')
    fireEvent.click(screen.getByRole('button', { name: '核对站点版本' }))
    const comparison = await screen.findByRole('dialog', { name: '核对文章版本' })
    expect(comparison).toHaveTextContent('站点的新正文')
    fireEvent.click(within(comparison).getByRole('button', { name: '保留当前内容继续编辑' }))
    expect(screen.getByRole('textbox', { name: '文章标题' })).toHaveValue('本地修改')
    fireEvent.click(screen.getByRole('button', { name: '更新发布' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: '更新已发布文章' })).getByRole('button', { name: '确认更新发布' }))
    expect(await screen.findByText('已发布到站点。')).toBeInTheDocument()
    const lastWrite = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').at(-1)?.[1]?.body
    expect(JSON.parse(typeof lastWrite === 'string' ? lastWrite : '{}')).toMatchObject({ title: '本地修改', expected_updated_at: latest.updated_at })
  })
})
