import './styles/posts.css'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, LoaderCircle, RotateCcw, RotateCw, Trash2, Upload } from 'lucide-react'

import { ApiError, downloadBlogArticles, getTrashedBlogPosts, permanentlyDeleteBlogPost, restoreBlogPost, type ArticleBatchAction, type ArticleOperationResult, type BlogPostAdmin, type BlogTag } from '../lib/api'
import { StudioIcon } from './StudioIcon'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'
import { PostImportDialog } from './PostImportDialog'
import { PostBatchDialog } from './PostBatchDialog'
import { articleActions } from './postManagement'

const pageSize = 40

function postState(post: BlogPostAdmin, trashed: boolean) {
  return trashed ? '回收站' : post.status === 'published' ? '已发布' : post.scheduled_at ? '定时发布' : '草稿'
}

function postCategories(post: BlogPostAdmin) {
  return (post.categories ?? (post.category ? [post.category] : [])).map(category => category.name).join('、') || '未分类'
}

function PostDate({ post, trashed }: { post: BlogPostAdmin; trashed: boolean }) {
  const timestamp = trashed ? post.deleted_at ?? post.updated_at : post.scheduled_at || post.updated_at
  return <time dateTime={timestamp}>{!trashed && post.scheduled_at ? new Date(timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : timestamp.slice(0, 10)}</time>
}

function PostSummary({ post, trashed }: { post: BlogPostAdmin; trashed: boolean }) {
  return <span className="studio-post-summary">
    <strong title={post.title}>{post.title || '未命名文章'}</strong>
    <small title={post.excerpt || '暂无摘要'}>{post.excerpt || '暂无摘要'}</small>
    <span className="studio-post-compact-meta">
      <span className="studio-post-compact-state">{postState(post, trashed)}</span>
      <span title={postCategories(post)}>{postCategories(post)}</span>
      <span className="studio-post-compact-date"><PostDate post={post} trashed={trashed} /></span>
    </span>
  </span>
}

export function PostsIndex({ posts, token, feedback, onRestored, onPendingChange, onCreatePost, onOpenPost, categories = [], tags = [], onRefresh }: {
  posts: BlogPostAdmin[]
  token: string
  feedback?: string | null
  onRestored: (post: BlogPostAdmin) => void
  onPendingChange: (pending: boolean) => void
  onCreatePost: () => void
  onOpenPost: (post: BlogPostAdmin) => void
  categories?: BlogTag[]
  tags?: BlogTag[]
  onRefresh?: () => Promise<void>
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
  const [importOpen, setImportOpen] = useState(false)
  const [batch, setBatch] = useState<{ action: ArticleBatchAction; posts: BlogPostAdmin[] } | null>(null)
  const [selection, setSelection] = useState<{ scope: string; posts: BlogPostAdmin[] }>({ scope: '', posts: [] })
  const [refreshing, setRefreshing] = useState(false)
  const refreshLock = useRef(false)
  const exportRequest = useRef<AbortController | null>(null)
  const exportFocus = useRef<HTMLButtonElement | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportError, setExportError] = useState('')
  const query = params.get('q') ?? ''
  const status = ['draft', 'published', 'scheduled', 'trash'].includes(params.get('status') ?? '') ? params.get('status')! : 'all'
  const inTrash = status === 'trash'
  const source = inTrash ? trash : posts
  const filtered = source.filter((post) => (inTrash || !post.deleted_at) && (inTrash || status === 'all' || (status === 'scheduled' ? post.scheduled_at : post.status === status)) && `${post.title} ${post.excerpt} ${(post.categories ?? (post.category ? [post.category] : [])).map(category => category.name).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)
  const scope = `${status}:${query}`
  if (selection.scope !== scope && selection.posts.length) setSelection({ scope, posts: [] })
  const selected = selection.scope === scope ? selection.posts : []
  const selectedIds = new Set(selected.map(post => post.id))
  const allVisible = visible.length > 0 && visible.every(post => selectedIds.has(post.id))

  function selectPosts(items: BlogPostAdmin[]) {
    if (items.length > 200) { setNotice('一次最多选择 200 篇，请缩小筛选范围或分批操作。'); return }
    setSelection({ scope, posts: items })
  }

  async function refresh() {
    if (refreshLock.current) return
    refreshLock.current = true; setRefreshing(true)
    try {
      await onRefresh?.()
      if (inTrash) { setTrash(await getTrashedBlogPosts(token)); setLoaded(true); setLoadError(null) }
      setSelection({ scope, posts: [] })
    } finally { refreshLock.current = false; setRefreshing(false) }
  }

  async function completed(result: ArticleOperationResult) {
    const message = `${importOpen ? '已导入草稿' : '操作已完成'} ${result.affected_ids.length} 篇。${result.skipped.length ? `未导入 ${result.skipped.length} 篇：${result.skipped.join('；')}` : ''}`
    setImportOpen(false); setBatch(null); setSelection({ scope, posts: [] }); setNotice(message)
    try { await refresh() } catch { setNotice(`${message} 列表刷新失败，请点击刷新列表；操作已提交，无需重新执行。`) }
    inputRef.current?.focus({ preventScroll: true })
  }

  // 有计划时定期重取列表；保存中不改变用户正在确认的版本快照。
  const refreshCallback = useRef(onRefresh)
  useEffect(() => { refreshCallback.current = onRefresh }, [onRefresh])
  const hasScheduled = posts.some(post => Boolean(post.scheduled_at))
  useEffect(() => {
    if (!hasScheduled || busy || batch || importOpen || refreshing) return
    const timer = window.setInterval(() => { void refreshCallback.current?.().catch(() => {}) }, 15000)
    return () => window.clearInterval(timer)
  }, [hasScheduled, busy, batch, importOpen, refreshing])

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
    setSelection({ scope: '', posts: [] })
    setNotice('')
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
    <section className="studio-post-index studio-article-index" aria-label="文章列表">
      <div className="studio-post-index__toolbar">
        <label className="studio-post-search" htmlFor="studio-post-search">
          <StudioIcon name="search" /><span className="sr-only">搜索文章</span>
          <input ref={inputRef} id="studio-post-search" aria-label="搜索文章" value={query} onChange={(event) => changeFilter('q', event.target.value)} placeholder="搜索标题、摘要或分类" />
          {query && <button type="button" aria-label="清空文章搜索" onClick={() => { changeFilter('q', ''); inputRef.current?.focus() }}><StudioIcon name="close" /></button>}
        </label>
        <div className="studio-post-index__actions">
          <button className="studio-post-export-all" type="button" disabled={busy} onClick={() => setImportOpen(true)}><Upload aria-hidden="true" />导入</button>
          <button className="studio-post-export-all" type="button" title={inTrash ? '导出回收站内全部已保存文章' : '导出全部草稿和已发布文章，不受筛选与分页影响'} disabled={Boolean(exporting) || source.length === 0} aria-busy={exporting === 'all'} onClick={event => { void exportArticles(undefined, event.currentTarget) }}>
            {exporting === 'all' ? <LoaderCircle className="studio-post-export-spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}<span>{inTrash ? '导出回收站' : '导出全部'}</span>
          </button>
          <button className="new-post-button" type="button" disabled={busy} onClick={onCreatePost}><StudioIcon name="plus" />新建文章</button>
        </div>
      </div>
      <div className="studio-post-index__filters" aria-label="文章筛选">
        {([['all', '全部'], ['draft', '草稿'], ['scheduled', '定时发布'], ['published', '已发布'], ['trash', '回收站']] as const).map(([value, label]) => <button key={value} type="button" className={status === value ? 'is-active' : ''} aria-pressed={status === value} onClick={() => changeFilter('status', value)}>{label}</button>)}
        <span className="studio-post-list-meta"><span className="studio-post-count" role="status">共 {filtered.length} 篇 · 最近更新</span>
        <button className="studio-post-refresh" type="button" aria-label={refreshing ? '刷新中…' : '刷新列表'} title="刷新列表" disabled={refreshing} onClick={() => { void refresh().then(() => setNotice('列表已刷新，原选择已清空。')).catch(() => setNotice('列表刷新失败，请检查网络后重试。')) }}><RotateCw className={refreshing ? 'studio-post-export-spinner' : undefined} aria-hidden="true" /></button></span>
      </div>
      <div className={selected.length ? 'studio-post-bulkbar' : 'sr-only'} aria-label="批量管理">
        <span role="status">已选 {selected.length} 篇</span>
        {selected.length > 0 && <><button type="button" onClick={() => selectPosts([])}>取消选择</button>{filtered.length > selected.length && <button type="button" disabled={filtered.length > 200} onClick={() => selectPosts(filtered)}>选择全部 {filtered.length} 篇匹配文章</button>}<label className="sr-only" htmlFor="post-batch-action">批量操作</label><select id="post-batch-action" value="" onChange={event => { if (event.target.value) setBatch({ action: event.target.value as ArticleBatchAction, posts: [...selected] }) }}><option value="" disabled>批量操作…</option>{(inTrash ? ['restore', 'permanent'] as const : ['publish', 'unpublish', 'categories', 'tags', 'schedule', 'cancel_schedule', 'trash'] as const).map(action => <option key={action} value={action}>{articleActions[action]}</option>)}</select></>}
        {filtered.length > 200 && <span>每批最多 200 篇</span>}
      </div>
      {(notice || feedback) && <p className="studio-post-notice" role="status">{notice || feedback}</p>}
      {exportError && <p className="studio-post-notice" role="alert">{exportError} <button type="button" className="studio-post-export-retry" disabled={Boolean(exporting)} onClick={() => { setExportError(''); inputRef.current?.focus() }}>关闭提示</button></p>}
      {exporting && <p className="studio-post-notice" role="status">正在准备导出，请稍候… <button className="studio-post-export-retry" type="button" onClick={() => { exportRequest.current?.abort(); exportRequest.current = null; setExporting(null); setNotice('已取消下载，可重新导出。') }}>取消下载</button></p>}
      {inTrash && <p className="studio-post-notice">回收站保留文章内容，恢复后存为草稿。彻底删除后无法恢复。</p>}
      <div className="studio-post-table-wrap">
        <table className={`studio-post-table${inTrash ? ' is-trash' : ''}`} aria-label={inTrash ? '回收站文章' : '文章管理表格'}>
          <thead><tr>
            <th className="studio-post-table__select" scope="col"><input type="checkbox" aria-label="选择本页文章" title="选择本页文章" checked={allVisible} ref={element => { if (element) element.indeterminate = !allVisible && visible.some(post => selectedIds.has(post.id)) }} disabled={!visible.length || Boolean(inTrash && (!loaded || loadError))} onChange={() => selectPosts(allVisible ? selected.filter(post => !visible.some(item => item.id === post.id)) : [...selected, ...visible.filter(post => !selectedIds.has(post.id))])} /></th>
            <th scope="col">文章</th><th className="studio-post-table__state" scope="col">状态</th><th className="studio-post-table__category" scope="col">分类</th><th className="studio-post-table__date" scope="col">{inTrash ? '移入时间' : '更新 / 计划'}</th><th className="studio-post-table__actions" scope="col"><span className={inTrash ? '' : 'sr-only'}>操作</span></th>
          </tr></thead>
          <tbody>{(!inTrash || (loaded && !loadError)) && visible.map(post => <tr className={selectedIds.has(post.id) ? 'is-selected' : undefined} key={post.id}>
            <td className="studio-post-table__select"><input type="checkbox" aria-label={`选择文章：${post.title}`} checked={selectedIds.has(post.id)} onChange={event => selectPosts(event.target.checked ? [...selected, post] : selected.filter(item => item.id !== post.id))} /></td>
            <td className="studio-post-table__main">{inTrash ? <div className="studio-post-open"><PostSummary post={post} trashed /></div> : <button className="studio-post-open" type="button" onClick={() => onOpenPost(post)}><PostSummary post={post} trashed={false} /></button>}</td>
            <td className="studio-post-table__state"><span className="studio-post-state">{postState(post, inTrash)}</span></td>
            <td className="studio-post-table__category"><span title={postCategories(post)}>{postCategories(post)}</span></td>
            <td className="studio-post-table__date"><PostDate post={post} trashed={inTrash} /></td>
            <td className="studio-post-table__actions">{inTrash ? <div className="studio-trash-actions"><button type="button" disabled={Boolean(exporting)} aria-label={`导出 Markdown：${post.title || '无标题文章'}`} onClick={event => { void exportArticles(post, event.currentTarget) }}><Download size={14} aria-hidden="true" />导出</button><button type="button" disabled={busy} onClick={() => { completionFocus.current = null; setError(null); setConfirmation({ post, action: 'restore' }) }}><RotateCcw size={14} />恢复为草稿</button><button type="button" disabled={busy} onClick={() => { completionFocus.current = null; setError(null); setConfirmation({ post, action: 'permanent' }) }}><Trash2 size={14} />彻底删除</button></div> : <button className="studio-post-export" type="button" disabled={Boolean(exporting)} aria-label={`导出 Markdown：${post.title || '无标题文章'}`} title="导出已保存的 Markdown" onClick={event => { void exportArticles(post, event.currentTarget) }}>{exporting === post.id ? <LoaderCircle className="studio-post-export-spinner" aria-hidden="true" /> : <Download aria-hidden="true" />}</button>}</td>
          </tr>)}</tbody>
        </table>
        {inTrash && loadError && <div className="studio-post-empty" role="alert"><strong>回收站暂时未能加载</strong><p>{loadError}</p><button type="button" onClick={() => { setLoadError(null); setRetry(value => value + 1) }}>重新加载</button></div>}
        {inTrash && !loaded && !loadError && <div className="studio-post-empty" role="status">正在读取回收站…</div>}
        {visible.length === 0 && (!inTrash || (loaded && !loadError)) && <div className="studio-post-empty">{inTrash ? <Trash2 aria-hidden="true" /> : <StudioIcon name="articles" />}<strong>{inTrash && !query ? '回收站是空的' : !inTrash && posts.length === 0 ? '还没有文章' : '没有匹配的文章'}</strong><p>{inTrash && !query ? '移入回收站的文章会出现在这里。' : posts.length === 0 && !inTrash ? '创建第一篇草稿，开始记录你的想法。' : '试试其他关键词，或切换文章状态。'}</p><button type="button" onClick={!inTrash && posts.length === 0 ? onCreatePost : () => { const next = new URLSearchParams(params); next.delete('q'); if (!inTrash || !query) next.delete('status'); next.delete('page'); setParams(next, { replace: true }); inputRef.current?.focus() }}>{inTrash && !query ? '返回文章' : posts.length === 0 && !inTrash ? '创建文章' : '清除筛选'}</button></div>}
      </div>
      <p className="studio-post-export-hint">{inTrash ? '导出回收站内全部已保存文章，保留删除状态。' : '导出全部草稿和已发布文章，不受筛选与分页影响。'}含分类与标签，不含评论、附件及独立页面。</p>
      {pages > 1 && <nav className="studio-post-pagination" aria-label="文章分页"><button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>上一页</button><span>{page} / {pages}</span><button type="button" disabled={page === pages} onClick={() => changePage(page + 1)}>下一页</button></nav>}
      {confirmation && <BlogWorkflowDialog title={confirmation.action === 'restore' ? '恢复文章' : '彻底删除文章'} description={confirmation.action === 'restore' ? `将「${confirmation.post.title}」恢复为草稿，文章不会自动公开。` : `彻底删除「${confirmation.post.title}」及其评论，无法恢复。已上传的附件和共享分类、标签会保留。`} confirmLabel={confirmation.action === 'restore' ? '恢复为草稿' : '彻底删除'} onConfirm={() => { void confirmAction() }} onCancel={() => setConfirmation(null)} busy={busy} error={error} returnFocus={completionFocus} />}
      {importOpen && <PostImportDialog token={token} onClose={() => setImportOpen(false)} onComplete={completed} onPendingChange={setBusy} />}
      {batch && <PostBatchDialog token={token} posts={batch.posts} action={batch.action} categories={categories} tags={tags} onClose={() => setBatch(null)} onComplete={completed} onPendingChange={setBusy} />}
    </section>
  )
}
