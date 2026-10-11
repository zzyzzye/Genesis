import { useEffect, useRef, useState } from 'react'
import { getPublicBlogLinks, type BlogLinkPublic } from '../../lib/api'
import './BlogLinks.css'

export function BlogLinks() {
  const [items, setItems] = useState<BlogLinkPublic[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const pending = useRef(false)
  const offset = useRef(0)

  async function load(start: number, signal: AbortSignal) {
    if (pending.current) return
    pending.current = true; setLoading(true); setError(false)
    try {
      const result = await getPublicBlogLinks(start, signal)
      if (signal.aborted) return
      setItems((current) => start === 0 ? result.items : [...new Map([...current, ...result.items].map((item) => [item.id, item])).values()])
      offset.current = start + result.items.length
      setTotal(result.items.length ? result.total : start)
    } catch { if (!signal.aborted) setError(true) }
    finally { if (!signal.aborted) { pending.current = false; setLoading(false) } }
  }

  useEffect(() => {
    const request = new AbortController()
    controller.current = request
    pending.current = false
    const timer = window.setTimeout(() => { void load(0, request.signal) }, 0)
    return () => { window.clearTimeout(timer); request.abort() }
  }, [retry])

  if (!loading && !error && total === 0) return null
  return <section className="blog-public-links" aria-labelledby="blog-links-title" aria-busy={loading}>
    <header><span>ELSEWHERE</span><h2 id="blog-links-title">站点链接</h2><p>值得停留的地方，继续阅读的线索。</p></header>
    {items.length > 0 && <ul aria-label="公开站点链接">{items.map((item) => <li key={item.id}><a href={item.url} target="_blank" rel="noopener noreferrer"><span>{item.name}<span aria-hidden="true"> ↗</span></span>{item.description && <small>{item.description}</small>}</a></li>)}</ul>}
    {loading && <p role="status">正在加载链接…</p>}
    {error && <div role="alert">链接暂时未能加载。<button type="button" onClick={() => { if (items.length && controller.current) void load(offset.current, controller.current.signal); else setRetry((value) => value + 1) }}>重试</button></div>}
    {!loading && !error && items.length < total && <button type="button" onClick={() => { if (controller.current) void load(offset.current, controller.current.signal) }}>查看更多链接</button>}
  </section>
}
