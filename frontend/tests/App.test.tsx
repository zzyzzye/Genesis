import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App'

const posts = {
  total: 2,
  items: [
    {
      id: 'post-1',
      slug: 'start-with-one-module',
      title: '从一个完整模块开始',
      excerpt: '先让一个模块完整跑通。',
      cover_image_url: null,
      is_featured: true,
      read_time_minutes: 3,
      published_at: '2026-09-02T00:00:00Z',
      author: {
        id: 'user-1',
        handle: 'genesis',
        display_name: 'Genesis',
        avatar_url: null,
      },
      tags: [{ id: 'tag-1', name: '产品', slug: 'product' }],
    },
    {
      id: 'post-2',
      slug: 'write-for-long-term',
      title: '把个人网站当作长期使用的空间',
      excerpt: '让内容自然连接。',
      cover_image_url: null,
      is_featured: false,
      read_time_minutes: 2,
      published_at: '2026-08-28T00:00:00Z',
      author: {
        id: 'user-1',
        handle: 'genesis',
        display_name: 'Genesis',
        avatar_url: null,
      },
      tags: [{ id: 'tag-2', name: '随笔', slug: 'notes' }],
    },
  ],
}

describe('App', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/')
    window.localStorage.removeItem('genesis-account-token')
    window.localStorage.removeItem('genesis-studio-token')
    vi.restoreAllMocks()
  })

  it('展示博客文章并可打开详情', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/blog/posts')) {
        return Promise.resolve(
          new Response(JSON.stringify(posts), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }
      if (url.endsWith('/blog/posts/start-with-one-module')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...posts.items[0],
              content_markdown: '# 从一个完整模块开始\n\n先把 **一件事** 做好。\n\n- 内容\n- 连接',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    window.history.pushState({}, '', '/blog')
    render(<App />)

    expect(await screen.findByRole('heading', { name: '最近的文章' })).toBeInTheDocument()
    expect(screen.getByText('2 篇记录')).toBeInTheDocument()
    expect(screen.getByText('把个人网站当作长期使用的空间')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('阅读 从一个完整模块开始'))

    expect(await screen.findByText('一件事', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回文章列表' })).toBeInTheDocument()
  })

  it('写作台登录后展示博客管理导航和仪表盘，并可进入文章编辑', async () => {
    const adminPosts = posts.items.map((post) => ({
      ...post,
      status: 'published' as const,
      content_markdown: `# ${post.title}`,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-05T00:00:00Z',
    }))

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/auth/login')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'test-token', token_type: 'bearer' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      if (url.endsWith('/auth/me')) {
        return Promise.resolve(new Response(JSON.stringify({
          id: 'user-1',
          handle: 'genesis',
          display_name: 'Genesis',
          bio: '',
          avatar_url: null,
          role: 'owner',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      }
      if (url.endsWith('/admin/blog/posts')) {
        return Promise.resolve(new Response(JSON.stringify(adminPosts), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    window.history.pushState({}, '', '/studio')
    const view = render(<App />)

    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } })
    fireEvent.click(screen.getByRole('button', { name: '进入写作台' }))

    expect(await screen.findByRole('heading', { name: '仪表盘' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '博客管理导航' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: '一级系统导航' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '快捷访问' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^文章$/ }))

    expect(window.location.pathname).toBe('/blog/studio/posts')
    expect(screen.getByRole('heading', { name: '文章管理' })).toBeInTheDocument()
    expect(screen.queryByText('一级')).not.toBeInTheDocument()
    expect(screen.queryByText('二级')).not.toBeInTheDocument()
    expect(screen.queryByText('三级')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '文章列表' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /从一个完整模块开始/ }))

    expect(window.location.pathname).toBe('/blog/studio/posts/post-1/edit')
    expect(screen.queryByRole('region', { name: '文章列表' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Markdown 编辑区' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: '文章标题' })).toHaveValue('从一个完整模块开始')
    fireEvent.click(screen.getByRole('button', { name: '预览' }))
    expect(window.location.pathname).toBe('/blog/studio/posts/post-1')
    expect(screen.getByRole('region', { name: '从一个完整模块开始' })).toBeInTheDocument()

    expect(window.localStorage.getItem('genesis-studio-token')).toBe('test-token')
    view.unmount()
    window.history.pushState({}, '', '/blog/studio')
    render(<App />)
    expect(await screen.findByRole('heading', { name: '仪表盘' })).toBeInTheDocument()
    expect(screen.queryByText('一级')).not.toBeInTheDocument()
    expect(screen.queryByText('二级')).not.toBeInTheDocument()
    expect(screen.queryByText('三级')).not.toBeInTheDocument()
  })

})
