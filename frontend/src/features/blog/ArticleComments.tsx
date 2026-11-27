import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useBlocker, useLocation } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { BlogWorkflowDialog } from '../../studio/BlogWorkflowDialog'
import { ApiError, getBlogComment, getBlogComments, submitBlogComment, type BlogComment } from '../../lib/api'
import { authTokenChangedEvent, getStoredAuthToken, studioAuthTokenKey } from '../../lib/auth'
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
  const [reply, setReply] = useState<BlogComment | null>(null)
  const [focused, setFocused] = useState<{ id: string; item?: BlogComment; error?: string } | null>(null)
  const focusId = new URLSearchParams(location.search).get('comment')
  useEffect(() => {
    if (!focusId) return
    const controller = new AbortController()
    void getBlogComment(slug, focusId, controller.signal).then(item => {
      if (!controller.signal.aborted) setFocused({ id: focusId, item })
    }).catch(() => { if (!controller.signal.aborted) setFocused({ id: focusId, error: '这条回复已不可见或暂时无法读取。' }) })
    return () => controller.abort()
  }, [slug, focusId, refresh])
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
    sync()
    window.addEventListener(authTokenChangedEvent, sync)
    window.addEventListener('storage', sync); window.addEventListener('focus', sync)
    return () => { mounted.current = false; window.removeEventListener(authTokenChangedEvent, sync); window.removeEventListener('storage', sync); window.removeEventListener('focus', sync) }
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
    const signature = JSON.stringify([body, qqValue.toLowerCase(), reply?.id])
    if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() }
    pending.current = true; setBusy(true); setError(''); setFeedback('')
    try {
      const receipt = reply ? await submitBlogComment(slug, currentToken, body, attempt.current.id, qqValue, true, reply.id) : await submitBlogComment(slug, currentToken, body, attempt.current.id, qqValue, true)
      if (!mounted.current) return
      setContent(''); setQq(''); attempt.current = null; setExpired(false)
      setReply(null)
      setFeedback(receipt.state === 'public' ? '评论已提交并公开。' : receipt.state === 'hidden' ? '这条评论已提交，目前未公开。' : '评论已提交，审核通过后会显示。')
      setOffset(0); setRefresh((value) => value + 1); input.current?.focus()
    } catch (reason) {
      if (!mounted.current) return
      if (reason instanceof ApiError && reason.status === 401) setExpired(true)
      setError(reason instanceof Error ? reason.message : '未能确认提交结果，请重试；相同内容的重试不会重复提交。')
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }

  function entry(item: BlogComment) {
    return <li key={item.id} id={`comment-${item.id}`}><CommentAvatar item={item} /><div className="article-comments__entry"><div className="article-comments__meta"><strong>{item.author_name}</strong><time dateTime={item.created_at}>{date(item.created_at)}</time></div><CommentSource item={item} />{item.reply_to && <div className="article-comments__reply-context">回复 {item.reply_to.author_name}：{item.reply_to.content}</div>}<p>{item.content}</p>{token && <button aria-label={`回复 ${item.author_name}`} disabled={busy} onClick={() => { setReply(item); setError(''); input.current?.focus(); input.current?.scrollIntoView({ block: 'center' }) }}>回复</button>}</div></li>
  }
  const focusedItem = focusId && focused?.id === focusId ? focused.item : undefined
  return <section className="article-comments" id="comments" aria-labelledby="article-comments-title">
    <header><h2 id="article-comments-title">评论{total > 0 && <span>{total}</span>}</h2><button className="article-comments__refresh" type="button" aria-label="刷新评论" title="刷新评论" disabled={loading} onClick={() => { setOffset(0); setRefresh((value) => value + 1) }}><RefreshCw size={15} aria-hidden="true" /></button></header>
    {token ? <form noValidate onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }}>
      <div className="article-comments__composer">
        {reply && <div className="article-comments__reply-target"><span>回复 {reply.author_name}</span><button type="button" disabled={busy} onClick={() => { setReply(null); input.current?.focus() }}>取消回复</button></div>}
        <div className="article-comments__identity">
          <CommentAvatarPreview qq={qq} token={token} />
          <input id="comment-qq" ref={qqInput} type="text" inputMode="email" autoComplete="off" maxLength={64} aria-label="QQ 邮箱（选填）" placeholder="QQ 邮箱（选填）" value={qq} disabled={busy} onChange={(event) => { setQq(event.target.value); setQqError(false); setError('') }} aria-invalid={qqError} aria-describedby="comment-error" />
        </div>
        <div className="article-comments__writing">
          <textarea className="resize-none" id="comment-content" ref={input} aria-label="写下评论" placeholder="写下你的想法…" rows={3} maxLength={2000} value={content} disabled={busy} onChange={(event) => { setContent(event.target.value); if (!qqError) setError('') }} aria-describedby={content.length >= 1800 ? 'comment-count comment-error' : 'comment-error'} aria-invalid={Boolean(error) && !qqError} />
          <div className="article-comments__composer-footer">
            {content.length >= 1800 && <span id="comment-count" className="article-comments__count">{content.length} / 2000</span>}
            <button type="submit" disabled={busy}>{busy ? '提交中…' : '提交评论'}</button>
          </div>
        </div>
      </div>
      <p id="comment-error" className="article-comments__error" role={error ? 'alert' : undefined}>{error}</p>
      {expired && <Link to={returnTo} target="_blank" rel="noopener noreferrer">重新登录（新标签页）</Link>}
      <p className="article-comments__feedback" role="status">{feedback}</p>
    </form> : <p><Link to={returnTo}>登录后参与讨论 ↗</Link></p>}
    <div className="article-comments__list" aria-busy={loading}>
      {focusId && <div className="article-comments__focused"><strong>定位的回复</strong>{focused?.id !== focusId ? <p role="status">正在定位回复…</p> : focused.error ? <p role="alert">{focused.error}<button onClick={() => setRefresh(value => value + 1)}>重试</button></p> : focusedItem && <ol aria-label="定位的回复">{entry(focusedItem)}</ol>}</div>}
      {items.length > 0 && <ol aria-label="公开评论">{items.filter(item => item.id !== focusedItem?.id).map(entry)}</ol>}
      {loading && <p role="status">正在加载评论…</p>}
      {loadError && <p role="alert">评论暂时未能加载。<button type="button" onClick={() => setRefresh((value) => value + 1)}>重试加载评论</button></p>}
      {!loading && !loadError && items.length < total && <button type="button" onClick={() => setOffset(offset + 20)}>查看更多评论</button>}
    </div>
    {blocker.state === 'blocked' && <BlogWorkflowDialog title={busy ? '正在提交评论' : dirty ? '评论还未提交' : '离开文章'} description={busy ? '请等待提交结果，再离开文章。' : dirty ? '离开后当前输入会丢失；取消可以继续编辑。' : '评论已提交，可以继续离开文章。'} confirmLabel={dirty ? '放弃评论并离开' : '继续离开'} busy={busy} onCancel={() => blocker.reset()} onConfirm={() => blocker.proceed()} />}
  </section>
}
