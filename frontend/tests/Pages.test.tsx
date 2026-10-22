import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { App } from '../src/App'

afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  sessionStorage.clear()
  vi.restoreAllMocks()
})

it.each([
  ['/blog/pages', '/blog', 'Genesis 博客'],
  ['/blog/pages/about', '/blog', 'Genesis 博客'],
  ['/blog/studio/pages', '/blog/studio', '仪表盘'],
  ['/blog/studio/pages/new/edit', '/blog/studio', '仪表盘'],
  ['/studio/blog/pages/about/edit', '/blog/studio', '仪表盘'],
])('停用页面功能后，旧地址 %s 返回所属首页', async (path, destination, heading) => {
  window.history.replaceState({}, '', path)
  localStorage.setItem('genesis-studio-token', 'pages-retirement-test-placeholder')
  const requests: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost')
    requests.push(url.pathname)
    const data = url.pathname.endsWith('/auth/me')
      ? { id: 'owner', handle: 'writer', display_name: '测试作者', bio: '', avatar_url: null, role: 'owner' }
      : url.pathname.startsWith('/api/v1/admin/') || url.pathname.endsWith('/blog/tags') ? [] : { items: [], total: 0 }
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } }))
  })
  render(<App />)
  expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument()
  await waitFor(() => expect(window.location.pathname).toBe(destination))
  expect(screen.queryByRole('button', { name: /^页面$/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /^页面$/ })).not.toBeInTheDocument()
  expect(requests.some(url => /\/blog\/pages(?:\/|$)/.test(url))).toBe(false)
})
