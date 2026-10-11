import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'
import { blogDraftKey } from '../src/studio/blogEditor'
import type { BlogPageAdmin } from '../src/lib/api'

const owner = { id: 'pages-test-author', handle: 'writer', display_name: '测试作者', bio: '', avatar_url: null, role: 'owner' }
const saved: BlogPageAdmin = { id: 'pages-record', slug: 'about', title: '关于站点', excerpt: '独立页面摘要', content_markdown: '# 页面正文\n\n真实内容', status: 'published', published_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }
const response = (data: unknown, status = 200) => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))

function setup(path: string, initial: BlogPageAdmin[] = []) {
  localStorage.setItem('genesis-studio-token', 'pages-test-placeholder')
  window.history.pushState({}, '', path)
  const store = new Map(initial.map(item => [item.id, item]))
  const control = { failNext: 0 }
  const writes: { method: string; data: Record<string, unknown> }[] = []
  let version = 1
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, 'http://localhost')
    if (url.pathname.endsWith('/auth/me')) return response(owner)
    const admin = '/api/v1/admin/blog/pages'
    if (url.pathname.startsWith(admin)) {
      const id = url.pathname.slice(admin.length + 1)
      if (['POST', 'PUT', 'DELETE'].includes(init?.method ?? '')) {
        const data = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>
        writes.push({ method: init!.method!, data })
        if (control.failNext) { const status = control.failNext; control.failNext = 0; return response({ detail: status === 409 ? '页面已更新，请核对站点版本' : '网络暂时不可用' }, status) }
        if (init?.method === 'DELETE') { store.delete(id); return response(null, 204) }
        const next = { ...saved, ...store.get(id), ...data, id: id || data.id, updated_at: `2026-10-11T00:00:${String(version++).padStart(2, '0')}Z` } as BlogPageAdmin
        store.set(next.id, next)
        return response(next)
      }
      if (id) return store.has(id) ? response(store.get(id)) : response({ detail: '页面不存在' }, 404)
      const query = url.searchParams.get('q') ?? ''
      const status = url.searchParams.get('status')
      const items = [...store.values()].filter(item => (!status || item.status === status) && (item.title + item.excerpt + item.slug).includes(query))
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return response({ items: items.slice(offset, offset + 20), total: items.length })
    }
    if (url.pathname.startsWith('/api/v1/blog/pages')) {
      const slug = url.pathname.slice('/api/v1/blog/pages/'.length)
      if (slug) { const item = [...store.values()].find(item => item.slug === slug && item.status === 'published'); return item ? response(item) : response({ detail: '页面不存在或尚未发布' }, 404) }
      const items = [...store.values()].filter(item => item.status === 'published')
      const offset = Number(url.searchParams.get('offset') ?? 0)
      return response({ items: items.slice(offset, offset + 20), total: items.length })
    }
    return response([])
  })
  const view = render(<App />)
  return { view, store, writes, control, fetchMock }
}

afterEach(() => { window.history.pushState({}, '', '/'); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks() })

describe('独立页面工作台', () => {
  it('服务端分页与筛选保存在 URL，返回列表恢复状态，空结果可清除', async () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ ...saved, id: 'page-' + i, title: '第 ' + i + ' 页', status: 'draft' as const }))
    setup('/blog/studio/pages?status=draft&page=2', items)
    fireEvent.click(await screen.findByRole('button', { name: /第 20 页/ }))
    expect(await screen.findByRole('textbox', { name: '页面标题' })).toHaveValue('第 20 页')
    fireEvent.click(screen.getByRole('button', { name: '← 返回页面列表' }))
    expect(await screen.findByRole('textbox', { name: '搜索页面' })).toBeInTheDocument()
    expect(window.location.search).toBe('?status=draft&page=2')
    fireEvent.change(screen.getByRole('textbox', { name: '搜索页面' }), { target: { value: '找不到' } })
    expect(await screen.findByText('没有匹配的页面')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清空页面搜索' }))
    expect(screen.getByRole('textbox', { name: '搜索页面' })).toHaveFocus()
    expect(window.location.search).toBe('?status=draft')
  })

  it('新页面预览不丢输入，离开先确认，页面恢复与文章暂存隔离', async () => {
    setup('/blog/studio/pages/new/edit')
    const field = await screen.findByRole('textbox', { name: '页面标题' })
    expect(screen.getByText('新页面 · 尚未保存')).toBeInTheDocument()
    fireEvent.change(field, { target: { value: '未保存页面' } })
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(await screen.findByRole('heading', { name: '未保存页面' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑页面' }))
    expect(await screen.findByRole('textbox', { name: '页面标题' })).toHaveValue('未保存页面')
    fireEvent.click(screen.getByRole('button', { name: '文章' }))
    expect(await screen.findByRole('dialog', { name: '还有未保存的页面内容' })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('textbox', { name: '页面标题' })).toHaveValue('未保存页面')
    fireEvent.click(screen.getByRole('button', { name: '文章' }))
    fireEvent.click(screen.getByRole('button', { name: '离开写作页' }))
    await screen.findByRole('heading', { name: '文章管理' })
    expect(sessionStorage.getItem(blogDraftKey(owner.id, null))).toBeNull()
    expect(sessionStorage.getItem(blogDraftKey(owner.id, null, 'page'))).toContain('未保存页面')
    fireEvent.click(screen.getByRole('button', { name: '页面' }))
    fireEvent.click(await screen.findByRole('button', { name: '新建页面' }))
    fireEvent.click(await screen.findByRole('button', { name: '恢复内容' }))
    expect(screen.getByRole('textbox', { name: '页面标题' })).toHaveValue('未保存页面')
  })

  it('创建失败保留输入，重试使用同一 UUID，成功后留在编辑页且按版本更新', async () => {
    const { control, writes } = setup('/blog/studio/pages/new/edit')
    fireEvent.change(await screen.findByRole('textbox', { name: '页面标题' }), { target: { value: '创建重试' } })
    control.failNext = 503
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await screen.findByText(/网络暂时不可用/)
    expect(screen.getByRole('textbox', { name: '页面标题' })).toHaveValue('创建重试')
    const save = screen.getByRole('button', { name: '保存草稿' })
    fireEvent.click(save); fireEvent.click(save)
    await screen.findByText('草稿已保存到站点。')
    expect(writes).toHaveLength(2)
    expect(writes[0]?.data.id).toBe(writes[1]?.data.id)
    await waitFor(() => expect(window.location.pathname).toBe(`/blog/studio/pages/${String(writes[1]?.data.id)}/edit`))
    fireEvent.change(screen.getByRole('textbox', { name: '页面标题' }), { target: { value: '更新草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    await waitFor(() => expect(writes.at(-1)?.method).toBe('PUT'))
    expect(writes.at(-1)?.data.expected_updated_at).toBe('2026-10-11T00:00:01Z')
  })

  it('更新公开内容先确认，版本冲突可取消核对或保留输入并采用新版本号', async () => {
    const { control, store, writes } = setup('/blog/studio/pages/pages-record/edit', [saved])
    fireEvent.change(await screen.findByRole('textbox', { name: '页面标题' }), { target: { value: '我的更新' } })
    expect(screen.queryByRole('button', { name: '保存草稿' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更新发布' }))
    expect(writes).toHaveLength(0)
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    control.failNext = 409
    fireEvent.click(screen.getByRole('button', { name: '确认发布页面' }))
    await screen.findByRole('button', { name: '核对站点版本' })
    store.set(saved.id, { ...saved, title: '另一页面更新', updated_at: '2026-10-10T00:00:00Z' })
    fireEvent.click(screen.getByRole('button', { name: '核对站点版本' }))
    await screen.findByRole('dialog', { name: '核对页面版本' })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '核对站点版本' }))
    fireEvent.click(await screen.findByRole('button', { name: '保留当前内容继续编辑' }))
    expect(screen.getByRole('textbox', { name: '页面标题' })).toHaveValue('我的更新')
    fireEvent.click(screen.getByRole('button', { name: '更新发布' }))
    fireEvent.click(screen.getByRole('button', { name: '确认发布页面' }))
    await screen.findByText('页面已发布到站点。')
    expect(writes.at(-1)?.data.expected_updated_at).toBe('2026-10-10T00:00:00Z')
  })

  it('撤回与删除都要确认，失败可重试，删除后回到列表', async () => {
    const { control, writes } = setup('/blog/studio/pages/pages-record/edit', [saved])
    await screen.findByRole('textbox', { name: '页面标题' })
    fireEvent.click(screen.getByRole('button', { name: '打开页面设置' }))
    expect(screen.queryByText('封面链接')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '撤回发布' }))
    expect(writes).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '确认撤回发布' }))
    await screen.findByText('已撤回发布，页面保留为草稿。')
    expect(writes.at(-1)?.data.status).toBe('draft')
    fireEvent.click(screen.getByRole('button', { name: '打开页面设置' }))
    fireEvent.click(screen.getByRole('button', { name: '删除页面' }))
    control.failNext = 503
    fireEvent.click(screen.getByRole('button', { name: '确认删除页面' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络暂时不可用')
    fireEvent.click(screen.getByRole('button', { name: '确认删除页面' }))
    expect(await screen.findByText('还没有页面')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/blog/studio/pages')
    expect(sessionStorage.getItem(blogDraftKey(owner.id, saved.id, 'page'))).toBeNull()
  })
})

describe('公开独立页面', () => {
  it('目录只展示公开页面，可读取正文并返回；草稿地址显示 404 状态', async () => {
    const { view } = setup('/blog/pages', [saved, { ...saved, id: 'draft', slug: 'private', title: '草稿不公开', status: 'draft' }])
    const list = await screen.findByRole('list', { name: '公开页面' })
    expect(within(list).queryByText('草稿不公开')).not.toBeInTheDocument()
    fireEvent.click(within(list).getByRole('link', { name: /关于站点/ }))
    expect(await screen.findByRole('heading', { name: '页面正文' })).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('关于站点 · Genesis'))
    view.unmount()
    vi.restoreAllMocks()
    setup('/blog/pages/private', [{ ...saved, slug: 'private', status: 'draft' }])
    expect(await screen.findByRole('heading', { name: '页面不存在或尚未发布' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← 返回页面目录' })).toHaveAttribute('href', '/blog/pages')
  })
})
