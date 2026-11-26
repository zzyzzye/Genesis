import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authHeaders, request, type BlogComment } from '../../lib/api'
import './BlogNotifications.css'

interface Notification { id: string; post_title: string; post_slug: string; comment: BlogComment; created_at: string; read_at: string | null }
interface Page { items: Notification[]; total: number; unread: number }
export function BlogNotifications({ token }: { token: string }) {
  const [data, setData] = useState<Page>({ items: [], total: 0, unread: 0 })
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void request<Page>(`/blog/notifications?offset=${offset}`, { headers: authHeaders(token), signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result)
    }).catch(() => { if (!controller.signal.aborted) setError('通知暂时未能加载，请重试。') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, offset, retry])
  async function mark(item: Notification) {
    if (pending) return
    setPending(item.id); setError('')
    try {
      await request(`/blog/notifications/${item.id}/read`, { method: 'PUT', headers: authHeaders(token) })
      setData(current => ({ ...current, unread: Math.max(0, current.unread - 1), items: current.items.map(row => row.id === item.id ? { ...row, read_at: new Date().toISOString() } : row) }))
    } catch { setError('未能标记已读，请重试。') }
    finally { setPending(null) }
  }
  function page(next: number) { setOffset(next); setLoading(true); setError('') }
  return <section className="blog-notifications" aria-labelledby="notifications-title">
    <header><div><h1 id="notifications-title">回复通知</h1><p>{data.unread ? `${data.unread} 条未读` : '查看评论收到的回复'}</p></div><button disabled={loading || Boolean(pending)} onClick={() => { setLoading(true); setError(''); setRetry(n => n + 1) }}>刷新</button></header>
    {error && <p role="alert">{error}<button onClick={() => { setError(''); setLoading(true); setRetry(n => n + 1) }}>重试</button></p>}
    {loading ? <p role="status">正在读取通知…</p> : <>
      {!data.items.length && !error && <p className="blog-notifications__empty">还没有回复通知。有人回复你的评论并通过审核后，会显示在这里。</p>}
      <ul>{data.items.map(item => <li key={item.id}><div className="blog-notifications__meta"><strong>{item.comment.author_name} 回复了你</strong>{!item.read_at && <span>未读</span>}<time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('zh-CN')}</time></div><p>{item.comment.content}</p><footer><Link to={`/articles/${encodeURIComponent(item.post_slug)}?comment=${encodeURIComponent(item.comment.id)}#comments`}>查看《{item.post_title}》中的回复</Link>{!item.read_at && <button disabled={Boolean(pending)} onClick={() => { void mark(item) }}>{pending === item.id ? '正在标记…' : '标为已读'}</button>}</footer></li>)}</ul>
      {data.total > 20 && <nav aria-label="通知分页"><button disabled={!offset || Boolean(pending)} onClick={() => page(offset - 20)}>上一页</button><span>{offset / 20 + 1} / {Math.ceil(data.total / 20)}</span><button disabled={offset + 20 >= data.total || Boolean(pending)} onClick={() => page(offset + 20)}>下一页</button></nav>}
    </>}
  </section>
}
