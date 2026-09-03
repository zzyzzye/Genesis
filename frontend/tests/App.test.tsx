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
              content_markdown: '# 从一个完整模块开始\n\n先把一件事做好。',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }
      return Promise.resolve(new Response(null, { status: 404 }))
    })

    render(<App />)

    expect(await screen.findByRole('heading', { name: '最近的文章' })).toBeInTheDocument()
    expect(screen.getByText('2 篇记录')).toBeInTheDocument()
    expect(screen.getByText('把个人网站当作长期使用的空间')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('阅读 从一个完整模块开始'))

    expect(await screen.findByText('先把一件事做好。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回文章列表' })).toBeInTheDocument()
  })
})
