import './styles/posts.css'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, LoaderCircle, RotateCcw, Trash2 } from 'lucide-react'

import { ApiError, downloadBlogArticles, getTrashedBlogPosts, permanentlyDeleteBlogPost, restoreBlogPost, type BlogPostAdmin } from '../lib/api'
import { StudioIcon } from './StudioIcon'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'

const pageSize = 40

export function PostsIndex({ posts, token, feedback, onRestored, onPendingChange, onCreatePost, onOpenPost }: {
  posts: BlogPostAdmin[]
  token: string
  feedback?: string | null
  onRestored: (post: BlogPostAdmin) => void
  onPendingChange: (pending: boolean) => void
  onCreatePost: () => void
  onOpenPost: (post: BlogPostAdmin) => void
}) {
  const [params, setParams] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const lock = useRef(false)
  const completionFocus = useRef<HTMLElement | null>(null)
  const [trash, setTrash] = useState<BlogPostAdmin[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [confirmation, setConfirmation] = useState<{ post: BlogPostAdmin; action: 'restore' | 'permanent' } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const exportRequest = useRef<AbortController | null>(null)
  const exportFocus = useRef<HTMLButtonElement | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportError, setExportError] = useState('')
  const query = params.get('q') ?? ''
  const status = ['draft', 'published', 'trash'].includes(params.get('status') ?? '') ? params.get('status')! : 'all'
  const inTrash = status === 'trash'
  const source = inTrash ? trash : posts
  const filtered = source.filter((post) => (inTrash || !post.deleted_at) && (inTrash || status === 'all' || post.status === status) && `${post.title} ${post.excerpt} ${(post.categories ?? (post.category ? [post.category] : [])).map(category => category.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

  useEffect(() => () => { exportRequest.current?.abort() }, [])
  useEffect(() => {
    if (!exporting && exportFocus.current) {
      if (document.activeElement === document.body || document.activeElement === exportFocus.current) exportFocus.current.focus({ preventScroll: true })
      exportFocus.current = null
    }
  }, [exporting])

  async function exportArticles(post?: BlogPostAdmin, trigger?: HTMLButtonElement) {
    if (exportRequest.current) return
    const controller = new AbortController()
    exportRequest.current = controller
    exportFocus.current = trigger ?? null
    setExporting(post?.id ?? 'all'); setExportError(''); setNotice('')
    try {
      await downloadBlogArticles(token, post ? { postId: post.id } : { trashed: inTrash }, controller.signal)
      if (!controller.signal.aborted) setNotice(`已开始下载${post ? `「${post.title || '无标题文章'}」的 Markdown` : inTrash ? '回收站文章 ZIP' : '全部文章 ZIP'}。`)
    } catch (reason) {
      if (!controller.signal.aborted) setExportError(reason instanceof TypeError ? '网络连接中断，请检查网络后重新导出。' : reason instanceof Error ? reason.message : '导出失败，请检查网络后重试。')
    } finally {
      if (exportRequest.current === controller) {
        exportRequest.current = null
        if (!controller.signal.aborted) setExporting(null)
      }
    }
  }

  useEffect(() => {
    if (!inTrash) return
    const controller = new AbortController()
    let cancelled = false
    getTrashedBlogPosts(token, controller.signal).then(items => {
      if (!cancelled) { setTrash(items); setLoaded(true); setLoadError(null) }
    }).catch(reason => { if (!cancelled) setLoadError(reason instanceof Error ? reason.message : '回收站读取失败，请重试。') })
    return () => { cancelled = true; controller.abort() }
  }, [inTrash, retry, token, posts])

  useEffect(() => {
    onPendingChange(busy)
    return () => onPendingChange(false)
  }, [busy, onPendingChange])

  async function confirmAction() {
    if (!confirmation || lock.current) return
    lock.current = true; setBusy(true); setError(null)
    try {
      if (confirmation.action === 'restore') {
        const post = await restoreBlogPost(token, confirmation.post)
        onRestored(post)
        setNotice(`「${post.title}」已恢复为草稿，尚未公开。`)
      } else {
        await permanentlyDeleteBlogPost(token, confirmation.post)
        setNotice(`「${confirmation.post.title}」已彻底删除。`)
      }
      setTrash(current => current.filter(post => post.id !== confirmation.post.id))
      completionFocus.current = inputRef.current
      setConfirmation(null)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '操作失败，请重试。'
      if (reason instanceof ApiError && (reason.status === 409 || reason.status === 404)) {
        setConfirmation(null); setNotice(message); setRetry(value => value + 1)
      } else setError(message)
    } finally { lock.current = false; setBusy(false) }
  }

  function changeFilter(key: 'q' | 'status', value: string) {
    const next = new URLSearchParams(params)
    if (value && value !== 'all') next.set(key, value)
    else next.delete(key)
    next.delete('page')
    setParams(next, { replace: true })
  }

  function changePage(value: number) {
    const next = new URLSearchParams(params)
    if (value > 1) next.set('page', String(value))
    else next.delete('page')
    setParams(next)
  }

  return (
    <section className="studio-post-index" aria-label="文章列表">
      <div className="studio-post-index__toolbar">
        <label className="studio-post-search" htmlFor="studio-post-search">
          <StudioIcon name="search" /><span className="sr-only">搜索文章</span>
          <input ref={inputRef} id="studio-post-search" aria-label="搜索文章" value={query} onChange={(event) => changeFilter('q', event.target.value)} placeholder="搜索标题、摘要或分类" />
          {query && <button type="button" aria-label="清空文章搜索" onClick={() => { changeFilter('q', ''); inputRef.current?.focus() }}><StudioIcon name="close" /></button>}
        </label>
        <div className="studio-post-index__actions">
          <button className="studio-post-export-all" type="button" disabled={Boolean(exporting) || source.length === 0} aria-busy={exporting === 'all'} onClick={event => { void exportArticles(undefined, event.currentTarget) }}>
            {exporting === 'all' ? <LoaderCircle className="studio-post-export-spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}<span>{inTrash ? '导出回收站' : '导出全部'}</span>
          </button>
          <button className="new-post-button" type="button" onClick={onCreatePost}><StudioIcon name="plus" />新建文章</button>
        </div>
      </div>
      <p className="studio-post-export-hint">{inTrash ? '导出回收站内全部已保存文章，保留删除状态。' : '导出全部草稿和已发布文章，不受筛选与分页影响。'}含分类与标签，不含评论、附件及独立页面。</p>
      <div className="studio-post-index__filters" aria-label="文章筛选">
        {([['all', '全部'], ['draft', '草稿'], ['published', '已发布'], ['trash', '回收站']] as const).map(([value, label]) => <button key={value} type="button" className={status === value ? 'is-active' : ''} aria-pressed={status === value} onClick={() => changeFilter('status', value)}>{label}</button>)}
        <span className="studio-post-count" role="status">共 {filtered.length} 篇 · 最近更新</span>
      </div>
      {(notice || feedback) && <p className="studio-post-notice" role="status">{notice || feedback}</p>}
      {exportError && <p className="studio-post-notice" role="alert">{exportError} <button type="button" className="studio-post-export-retry" disabled={Boolean(exporting)} onClick={() => { setExportError(''); inputRef.current?.focus() }}>关闭提示</button></p>}
      {exporting && <p className="studio-post-notice" role="status">正在准备导出，请稍候… <button className="studio-post-export-retry" type="button" onClick={() => { exportRequest.current?.abort(); exportRequest.current = null; setExporting(null); setNotice('已取消下载，可重新导出。') }}>取消下载</button></p>}
      {inTrash && <p className="studio-post-notice">回收站保留文章内容，恢复后存为草稿。彻底删除后无法恢复。</p>}
      <div className="studio-content-list">
        {inTrash && loadError ? <div className="studio-post-empty" role="alert"><strong>回收站暂时未能加载</strong><p>{loadError}</p><button type="button" onClick={() => { setLoadError(null); setRetry(value => value + 1) }}>重新加载</button></div> : inTrash && !loaded ? <div className="studio-post-empty" role="status">正在读取回收站…</div> : visible.map((post) => inTrash ? (
          <article key={post.id} className="studio-trash-row" aria-label={post.title}>
            <Trash2 aria-hidden="true" />
            <div className="studio-content-list__body"><strong>{post.title}</strong><small>{post.excerpt || '暂无摘要'}</small><div className="studio-content-list__details"><span>移入时间</span><time dateTime={post.deleted_at ?? post.updated_at}>{(post.deleted_at ?? post.updated_at).slice(0, 10)}</time></div></div>
            <div className="studio-trash-actions"><button type="button" disabled={Boolean(exporting)} aria-label={`导出 Markdown：${post.title || '无标题文章'}`} onClick={event => { void exportArticles(post, event.currentTarget) }}><Download size={14} aria-hidden="true" />导出</button><button type="button" disabled={busy} onClick={() => { completionFocus.current = null; setError(null); setConfirmation({ post, action: 'restore' }) }}><RotateCcw size={14} />恢复为草稿</button><button type="button" disabled={busy} onClick={() => { completionFocus.current = null; setError(null); setConfirmation({ post, action: 'permanent' }) }}><Trash2 size={14} />彻底删除</button></div>
          </article>
        ) : (
          <div className="studio-post-row" key={post.id}>
          <button className="studio-content-list__item" type="button" onClick={() => onOpenPost(post)}>
            <StudioIcon name="articles" />
            <span className="studio-content-list__body">
              <strong>{post.title}</strong>
              <small>{post.excerpt || '暂无摘要'}</small>
              <span className="studio-content-list__details"><em>{post.status === 'published' ? '已发布' : '草稿'}</em><span>{(post.categories ?? (post.category ? [post.category] : [])).map(category => category.name).join('、') || '未分类'}</span><time dateTime={post.updated_at}>{post.updated_at.slice(0, 10)}</time></span>
            </span>
            <StudioIcon name="chevron" />
          </button>
          <button className="studio-post-export" type="button" disabled={Boolean(exporting)} aria-label={`导出 Markdown：${post.title || '无标题文章'}`} title="导出已保存的 Markdown" onClick={event => { void exportArticles(post, event.currentTarget) }}>{exporting === post.id ? <LoaderCircle className="studio-post-export-spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}</button>
          </div>
        ))}
        {visible.length === 0 && (!inTrash || (loaded && !loadError)) && <div className="studio-post-empty">{inTrash ? <Trash2 aria-hidden="true" /> : <StudioIcon name="articles" />}<strong>{inTrash && !query ? '回收站是空的' : !inTrash && posts.length === 0 ? '还没有文章' : '没有匹配的文章'}</strong><p>{inTrash && !query ? '移入回收站的文章会出现在这里。' : posts.length === 0 && !inTrash ? '创建第一篇草稿，开始记录你的想法。' : '试试其他关键词，或切换文章状态。'}</p><button type="button" onClick={!inTrash && posts.length === 0 ? onCreatePost : () => { const next = new URLSearchParams(params); next.delete('q'); if (!inTrash || !query) next.delete('status'); next.delete('page'); setParams(next, { replace: true }); inputRef.current?.focus() }}>{inTrash && !query ? '返回文章' : posts.length === 0 && !inTrash ? '创建文章' : '清除筛选'}</button></div>}
      </div>
      {pages > 1 && <nav className="studio-post-pagination" aria-label="文章分页"><button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>上一页</button><span>{page} / {pages}</span><button type="button" disabled={page === pages} onClick={() => changePage(page + 1)}>下一页</button></nav>}
      {confirmation && <BlogWorkflowDialog title={confirmation.action === 'restore' ? '恢复文章' : '彻底删除文章'} description={confirmation.action === 'restore' ? `将「${confirmation.post.title}」恢复为草稿，文章不会自动公开。` : `彻底删除「${confirmation.post.title}」及其评论，无法恢复。已上传的附件和共享分类、标签会保留。`} confirmLabel={confirmation.action === 'restore' ? '恢复为草稿' : '彻底删除'} onConfirm={() => { void confirmAction() }} onCancel={() => setConfirmation(null)} busy={busy} error={error} returnFocus={completionFocus} />}
    </section>
  )
}
