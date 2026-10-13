import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useBlocker, useLocation } from 'react-router-dom'
import { ArrowUpRight, MessageSquare, RefreshCw } from 'lucide-react'
import { BlogWorkflowDialog } from '../../studio/BlogWorkflowDialog'
import { ApiError, getBlogComments, submitBlogComment, type BlogComment } from '../../lib/api'
import { getStoredAuthToken, studioAuthTokenKey } from '../../lib/auth'
import './ArticleComments.css'
import { CommentAvatar, CommentSource } from './CommentSource'
import { CommentAvatarPreview } from './CommentAvatarPreview'

const readToken = () => getStoredAuthToken() ?? getStoredAuthToken(studioAuthTokenKey)
const date = (value: string) => new Date(value).toLocaleString('zh-CN')

export function ArticleComments({ slug }: { slug: string }) {
  const location = useLocation()
  const [items, setItems] = useState<BlogComment[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [offset, setOffset] = useState(0)
  const [token, setToken] = useState(readToken)
  const [content, setContent] = useState('')
  const [qq, setQq] = useState('')
  const [qqError, setQqError] = useState(false)
  const qqInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const pending = useRef(false)
  const attempt = useRef<{ signature: string; id: string } | null>(null)
  const mounted = useRef(true)
  const anchored = useRef(false)
  const dirty = Boolean(content.trim() || qq.trim())
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (dirty || pending.current) && currentLocation.pathname !== nextLocation.pathname)
  const returnTo = '/account?returnTo=' + encodeURIComponent('/articles/' + slug + '#comments')

  useEffect(() => {
    mounted.current = true
    const sync = () => setToken(readToken())
    window.addEventListener('storage', sync); window.addEventListener('focus', sync)
    return () => { mounted.current = false; window.removeEventListener('storage', sync); window.removeEventListener('focus', sync) }
  }, [])
  useEffect(() => {
    if (!dirty && !busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])
  useEffect(() => {
    if (loading || location.hash !== '#comments' || anchored.current) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById('comments')?.scrollIntoView()
      anchored.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [loading, location.hash])
  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setLoadError(false)
      void getBlogComments(slug, offset, controller.signal).then((data) => {
        if (controller.signal.aborted) return
        setItems((current) => offset === 0 ? data.items : [...new Map([...current, ...data.items].map((item) => [item.id, item])).values()])
        setTotal(data.items.length ? data.total : offset)
      }).catch(() => { if (!controller.signal.aborted) setLoadError(true) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [slug, offset, refresh])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    setQqError(false)
    const body = content.trim()
    if (!body || body.length > 2000) { setError('请填写 1–2000 字的评论。'); input.current?.focus(); return }
    const qqValue = qq.trim()
    if (qqValue && !/^[1-9][0-9]{4,10}(?:@qq\.com)?$/i.test(qqValue)) { setQqError(true); setError('请填写数字 QQ 邮箱，例如 12345@qq.com。'); qqInput.current?.focus(); return }
    const currentToken = readToken()
    if (!currentToken) { setExpired(true); setError('请先登录，当前输入会保留在此页面。'); return }
    const signature = JSON.stringify([body, qqValue.toLowerCase()])
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() }
    pending.current = true; setBusy(true); setError(''); setFeedback('')
    try {
      const receipt = await submitBlogComment(slug, currentToken, body, attempt.current.id, qqValue, true)
      if (!mounted.current) return
      setContent(''); setQq(''); attempt.current = null; setExpired(false)
      setFeedback(receipt.state === 'public' ? '评论已提交并公开。' : receipt.state === 'hidden' ? '这条评论已提交，目前未公开。' : '评论已提交，审核通过后会显示。')
      setOffset(0); setRefresh((value) => value + 1); input.current?.focus()
    } catch (reason) {
      if (!mounted.current) return
      if (reason instanceof ApiError && reason.status === 401) setExpired(true)
      setError(reason instanceof Error ? reason.message : '未能确认提交结果，请重试；相同内容的重试不会重复提交。')
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }

  return <section className="article-comments" id="comments" aria-labelledby="article-comments-title">
    <header><h2 id="article-comments-title"><MessageSquare size={18} aria-hidden="true" />文章讨论 <span>{total}</span></h2><button className="article-comments__refresh" type="button" disabled={loading} onClick={() => { setOffset(0); setRefresh((value) => value + 1) }}><RefreshCw size={14} aria-hidden="true" />刷新评论</button></header>
    {token ? <form noValidate onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }}>
      <div className="article-comments__composer">
        <div className="article-comments__identity">
          <CommentAvatarPreview qq={qq} token={token} />
          <input id="comment-qq" ref={qqInput} type="text" inputMode="email" autoComplete="off" maxLength={64} aria-label="QQ 邮箱（选填）" placeholder="输入 QQ 邮箱自动获取头像" value={qq} disabled={busy} onChange={(event) => { setQq(event.target.value); setQqError(false); setError('') }} aria-invalid={qqError} aria-describedby="comment-error" />
        </div>
        <div className="article-comments__writing">
          <textarea id="comment-content" ref={input} aria-label="写下评论" placeholder="聊聊你的看法，让讨论从这里开始。" rows={4} maxLength={2000} value={content} disabled={busy} onChange={(event) => { setContent(event.target.value); if (!qqError) setError('') }} aria-describedby="comment-help comment-error" aria-invalid={Boolean(error) && !qqError} />
          <div className="article-comments__composer-footer">
            <div className="article-comments__composer-meta"><span id="comment-help">审核通过后公开</span><span>{content.length}<span className="article-comments__limit"> / 2000</span></span></div>
            <button type="submit" disabled={busy}>{busy ? '提交中…' : '提交评论'}<ArrowUpRight size={15} aria-hidden="true" /></button>
          </div>
        </div>
      </div>
      <p id="comment-error" className="article-comments__error" role={error ? 'alert' : undefined}>{error}</p>
      {expired && <Link to={returnTo} target="_blank" rel="noopener noreferrer">重新登录（新标签页）</Link>}
      <p className="article-comments__feedback" role="status">{feedback}</p>
    </form> : <p><Link to={returnTo}>登录后参与讨论 ↗</Link></p>}
    <div className="article-comments__list" aria-busy={loading}>
      {items.length > 0 && <ol aria-label="公开评论">{items.map((item) => <li key={item.id}><CommentAvatar item={item} /><div className="article-comments__entry"><div className="article-comments__meta"><strong>{item.author_name}</strong><time dateTime={item.created_at}>{date(item.created_at)}</time></div><CommentSource item={item} /><p>{item.content}</p></div></li>)}</ol>}
      {loading && <p role="status">正在加载评论…</p>}
      {loadError && <p role="alert">评论暂时未能加载。<button type="button" onClick={() => setRefresh((value) => value + 1)}>重试加载评论</button></p>}
      {!loading && !loadError && items.length === 0 && <p>还没有公开评论，欢迎留下你的想法。</p>}
      {!loading && !loadError && items.length < total && <button type="button" onClick={() => setOffset(offset + 20)}>查看更多评论</button>}
    </div>
    {blocker.state === 'blocked' && <BlogWorkflowDialog title={busy ? '正在提交评论' : dirty ? '评论还未提交' : '离开文章'} description={busy ? '请等待提交结果，再离开文章。' : dirty ? '离开后当前输入会丢失；取消可以继续编辑。' : '评论已提交，可以继续离开文章。'} confirmLabel={dirty ? '放弃评论并离开' : '继续离开'} busy={busy} onCancel={() => blocker.reset()} onConfirm={() => blocker.proceed()} />}
  </section>
}
