import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { blogSeoPlugin } from '../blogSeoPlugin'
import { BlogMetadata } from '../src/features/blog/BlogMetadata'

afterEach(() => {
  cleanup(); vi.restoreAllMocks()
  document.head.querySelectorAll('[data-blog-seo]').forEach(node => node.remove())
})

describe('博客收录元数据', () => {
  it('切换私有页面清除分享信息，迟到的文章响应不能覆盖 noindex', async () => {
    let finish: (response: Response) => void = () => undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    document.head.insertAdjacentHTML('beforeend', '<meta data-blog-seo property="og:title" content="旧文章">')
    const router = createMemoryRouter([{ path: '*', element: <BlogMetadata /> }], { initialEntries: ['/articles/test'] })
    render(<RouterProvider router={router} />)
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await act(async () => { await router.navigate('/account') })
    await act(async () => { finish(new Response('<meta data-blog-seo property="og:title" content="迟到文章">', { headers: { 'Content-Type': 'text/html' } })); await Promise.resolve() })
    expect(document.head.querySelector('[property="og:title"]')).toBeNull()
    expect(document.head.querySelector('[name="robots"]')).toHaveAttribute('content', 'noindex, follow')
  })

  it('站内文章加载后替换默认规则并插入 canonical 与结构化数据', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<meta data-blog-seo name="robots" content="index, follow"><link data-blog-seo rel="canonical" href="https://example.test/articles/test"><script data-blog-seo type="application/ld+json">{"@type":"BlogPosting"}</script>', { headers: { 'Content-Type': 'text/html' } }))
    const router = createMemoryRouter([{ path: '*', element: <BlogMetadata /> }], { initialEntries: ['/articles/test'] })
    render(<RouterProvider router={router} />)
    await waitFor(() => expect(document.head.querySelector('[rel="canonical"]')).toHaveAttribute('href', 'https://example.test/articles/test'))
    expect(document.head.querySelectorAll('[name="robots"]')).toHaveLength(1)
    expect(document.head.querySelector('[type="application/ld+json"]')).toHaveTextContent('BlogPosting')
  })

  it('生产 HTML 钩子输出按请求读取的 SSI 与降级标记，不固化开发域名', async () => {
    const hook = blogSeoPlugin('http://backend:8000').transformIndexHtml
    if (!hook || typeof hook === 'function' || !('handler' in hook)) throw new Error('缺少 HTML 钩子')
    const transform: OmitThisParameter<typeof hook.handler> = hook.handler
    const output = await transform('<head><title>Genesis</title><meta name="description" content="Genesis 应用" /></head>', { path: '/', filename: 'index.html' })
    expect(output).toContain('include virtual="/api/v1/blog/seo/head?path=$request_uri"')
    expect(output).toContain('noindex, follow')
    expect(output).not.toContain('localhost')
    expect(output).not.toContain('Genesis 应用')
  })
})
