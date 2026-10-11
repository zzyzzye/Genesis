import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getAdminBlogComments, moderateBlogComment, type BlogCommentAdmin, type BlogCommentState } from '../lib/api'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'
import './LinksWorkspace.css'
import './CommentsWorkspace.css'

const labels: Record<BlogCommentState, string> = { pending: '待审核', public: '公开', hidden: '隐藏' }
type Action = { item: BlogCommentAdmin; state: BlogCommentState | 'delete' }

export function CommentsWorkspace({ token, onPendingChange, navigationBlocked, onCancelNavigation, onConfirmNavigation }: {
  token: string; onPendingChange: (pending: boolean) => void; navigationBlocked: boolean
  onCancelNavigation: () => void; onConfirmNavigation: () => void
}) {
  const [params, setParams] = useSearchParams()
  const query = (params.get('q') ?? '').slice(0, 200)
  const state = ['pending', 'public', 'hidden'].includes(params.get('state') ?? '') ? params.get('state')! : 'all'
  const rawPage = Number(params.get('page') ?? 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const [items, setItems] = useState<BlogCommentAdmin[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [composing, setComposing] = useState(false)
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(true)
  const focusAfterRefresh = useRef(false)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onPendingChange(false) } }, [onPendingChange])
  useLayoutEffect(() => { if (!loading && focusAfterRefresh.current) { focusAfterRefresh.current = false; search.current?.focus() } }, [items, loading])
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) { if (value && value !== 'all' && !(key === 'page' && value === '1')) next.set(key, value); else next.delete(key) }
    setParams(next, { replace: true })
  }
  useEffect(() => {
    if (composing) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      void getAdminBlogComments(token, query, state, page, controller.signal).then((data) => {
        if (controller.signal.aborted) return
        const maxPage = Math.max(1, Math.ceil(data.total / 20))
        if (page > maxPage) { setParams((current) => { const next = new URLSearchParams(current); if (maxPage === 1) next.delete('page'); else next.set('page', String(maxPage)); return next }, { replace: true }); return }
        setItems(data.items); setTotal(data.total)
      }).catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '评论加载失败，请重试。') }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [token, query, state, page, refresh, composing, setParams])
  function ask(item: BlogCommentAdmin, next: Action['state']) { setAction({ item, state: next }); setMutationError('') }
  async function execute() {
    if (pending.current || !action) return
    pending.current = true; setBusy(true); setMutationError(''); onPendingChange(true)
    try {
      await moderateBlogComment(token, action.item, action.state)
      if (!mounted.current) return
      setNotice(action.state === 'delete' ? '评论已删除。' : '评论已设为' + labels[action.state] + '。')
      focusAfterRefresh.current = true; setLoading(true); setAction(null); setRefresh((value) => value + 1)
    } catch (reason) { if (mounted.current) setMutationError(reason instanceof Error ? reason.message : '未能完成操作，请重试。') }
    finally { pending.current = false; if (mounted.current) { setBusy(false); onPendingChange(false) } }
  }

  return <section className="blog-links-workspace blog-comments-workspace" aria-label="评论管理">
    <header><div><h2>文章评论 <span>{total}</span></h2><p>新评论先待审核；公开后才会显示在已发布文章下。</p></div></header>
    <div className="blog-links__search"><input ref={search} aria-label="搜索评论" placeholder="搜索评论、昵称或文章标题" maxLength={200} value={query} onChange={(event) => update({ q: event.target.value, page: '1' })} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />{query && <button type="button" aria-label="清空评论搜索" onClick={() => { update({ q: '', page: '1' }); search.current?.focus() }}>清空</button>}</div>
    <div className="blog-links__filters" aria-label="评论审核状态">{(['all', 'pending', 'public', 'hidden'] as const).map((value) => <button key={value} type="button" aria-pressed={state === value} onClick={() => update({ state: value, page: '1' })}>{value === 'all' ? '全部' : labels[value]}</button>)}<button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>刷新列表</button></div>
    <p className="blog-links__notice" role="status">{notice}</p>
    <div className="blog-links__content" aria-busy={loading}>
      {loading ? <p role="status">正在加载评论…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>重新加载</button></div> : items.length === 0 ? <div className="blog-links__empty"><h3>{query || state !== 'all' ? '没有匹配的评论' : '还没有评论'}</h3><p>{query || state !== 'all' ? '换个搜索词，或清除筛选。' : '读者在公开文章下提交后，会出现在这里。'}</p>{(query || state !== 'all') && <button type="button" onClick={() => update({ q: '', state: 'all', page: '1' })}>清除筛选</button>}</div> : <ul aria-label="评论列表">{items.map((item) => <li key={item.id}>
        <div className="blog-comment__meta"><strong>{item.author_name}</strong><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString('zh-CN')}</time><span>{labels[item.state]}</span></div><p className="blog-comment__body">{item.content}</p>
        <div className="blog-comment__footer">{item.post_status === 'published' ? <Link to={'/articles/' + item.post_slug + '#comments'} target="_blank" rel="noopener noreferrer">{item.post_title} ↗</Link> : <span>{item.post_title} · 文章未发布</span>}<div className="blog-links__actions">{item.state !== 'public' && <button type="button" onClick={() => ask(item, 'public')}>公开</button>}{item.state !== 'hidden' && <button type="button" onClick={() => ask(item, 'hidden')}>隐藏</button>}<button type="button" onClick={() => ask(item, 'delete')}>删除</button></div></div>
      </li>)}</ul>}
    </div>
    {!error && total > 20 && <nav className="blog-links__pagination" aria-label="评论分页"><button type="button" disabled={page === 1 || loading} onClick={() => update({ page: String(page - 1) })}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil(total / 20))} 页 · {total} 条</span><button type="button" disabled={page * 20 >= total || loading} onClick={() => update({ page: String(page + 1) })}>下一页</button></nav>}
    {navigationBlocked ? <BlogWorkflowDialog title={busy ? '正在处理评论' : '离开评论管理'} description={busy ? '请等待操作结果，再离开此页面。' : '可以继续离开，尚未完成的审核确认会关闭。'} confirmLabel="继续离开" busy={busy} onCancel={onCancelNavigation} onConfirm={onConfirmNavigation} /> : action && <BlogWorkflowDialog title={action.state === 'delete' ? '删除评论' : action.state === 'public' ? '公开评论' : '隐藏评论'} description={action.state === 'delete' ? '删除后无法恢复，公开文章下也会移除此评论；不会删除文章或账户。' : action.state === 'public' ? '确认后，昵称、正文和时间会显示在所属文章下。文章未发布时仍不会公开展示。' : '确认后，评论将从公开文章中隐藏，后台仍保留记录。'} confirmLabel={action.state === 'delete' ? '确认删除' : action.state === 'public' ? '确认公开' : '确认隐藏'} busy={busy} error={mutationError} onCancel={() => { if (!pending.current) setAction(null) }} onConfirm={() => void execute()}><blockquote>{action.item.content}</blockquote></BlogWorkflowDialog>}
  </section>
}
