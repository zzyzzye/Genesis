import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function BlogMetadata() {
  const { pathname } = useLocation()
  useEffect(() => {
    const controller = new AbortController()
    // 路由切换时先清除上一篇分享信息，避免暂时把私有页标成公开文章。
    document.head.querySelectorAll('[data-blog-seo]:not(title)').forEach(node => node.remove())
    const robots = document.createElement('meta')
    robots.name = 'robots'; robots.content = 'noindex, follow'; robots.dataset.blogSeo = ''
    document.head.append(robots)
    if (!(pathname === '/' || pathname === '/blog' || pathname.startsWith('/articles/'))) return () => controller.abort()
    void fetch(`/api/v1/blog/seo/head?${new URLSearchParams({ path: pathname })}`, { signal: controller.signal }).then(async response => {
      if (!response.ok || !response.headers.get('Content-Type')?.includes('text/html')) return
      const html = await response.text()
      if (controller.signal.aborted) return
      const parsed = new DOMParser().parseFromString(html, 'text/html')
      document.head.querySelectorAll('[data-blog-seo]:not(title)').forEach(node => node.remove())
      parsed.head.querySelectorAll('[data-blog-seo]:not(title)').forEach(node => document.head.append(document.importNode(node, true)))
    }).catch(() => { /* 保留不收录状态，正文读取与重试由页面自身负责。 */ })
    return () => controller.abort()
  }, [pathname])
  return null
}
