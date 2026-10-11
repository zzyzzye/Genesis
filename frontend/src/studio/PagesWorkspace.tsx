import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getAdminBlogPages, type BlogPageAdmin } from '../lib/api'
import { ArticleReader, MarkdownEditor } from './MarkdownEditor'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'
import { StudioIcon } from './StudioIcon'
import type { PagesController } from './usePagesWorkspace'
import './styles/posts.css'

function PagesIndex({ token, controller }: { token: string; controller: PagesController }) {
  const [params, setParams] = useSearchParams()
  const query = (params.get('q') ?? '').slice(0, 200)
  const status = ['draft', 'published'].includes(params.get('status') ?? '') ? params.get('status')! : 'all'
  const parsedPage = Number(params.get('page') ?? 1)
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const [items, setItems] = useState<BlogPageAdmin[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [composing, setComposing] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  function update(values: Record<string, string>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) { if (value && value !== 'all' && !(key === 'page' && value === '1')) next.set(key, value); else next.delete(key) }
    setParams(next, { replace: true })
  }
  useEffect(() => {
    if (composing) return
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setError('')
      void getAdminBlogPages(token, query, status, page, abort.signal).then((data) => {
        if (abort.signal.aborted) return
        const maxPage = Math.max(1, Math.ceil(data.total / 20))
        if (page > maxPage) { setParams(current => { const next = new URLSearchParams(current); if (maxPage === 1) next.delete('page'); else next.set('page', String(maxPage)); return next }, { replace: true }); return }
        setItems(data.items); setTotal(data.total)
      }).catch(reason => { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : '页面列表加载失败，请重试。') }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    }, 300)
    return () => { window.clearTimeout(timer); abort.abort() }
  }, [token, query, status, page, refresh, composing, setParams])
  return <section className="studio-post-index studio-page-index" aria-label="页面列表">
    <div className="studio-post-index__toolbar">
      <label className="studio-post-search" htmlFor="studio-page-search"><StudioIcon name="search" /><span className="sr-only">搜索页面</span><input ref={search} autoFocus id="studio-page-search" maxLength={200} value={query} onChange={event => update({ q: event.target.value, page: '1' })} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} placeholder="搜索标题、摘要或地址" />{query && <button type="button" aria-label="清空页面搜索" onClick={() => { update({ q: '', page: '1' }); search.current?.focus() }}><StudioIcon name="close" /></button>}</label>
      <button className="new-post-button" type="button" onClick={controller.create}><StudioIcon name="plus" />新建页面</button>
    </div>
    <div className="studio-post-index__filters" aria-label="页面筛选">{([['all', '全部'], ['draft', '草稿'], ['published', '已发布']] as const).map(([value, label]) => <button key={value} type="button" className={status === value ? 'is-active' : ''} aria-pressed={status === value} onClick={() => update({ status: value, page: '1' })}>{label}</button>)}<button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>刷新列表</button><span className="studio-post-count" role="status">共 {total} 页 · 最近更新</span></div>
    {controller.feedback && <p role="status">{controller.feedback}</p>}
    <div className="studio-content-list" aria-busy={loading}>
      {loading ? <p role="status">正在加载页面…</p> : error ? <div role="alert"><p>{error}</p><button className="secondary-button" type="button" onClick={() => setRefresh(value => value + 1)}>重新加载</button></div> : items.length ? items.map(item => <button className="studio-content-list__item" key={item.id} type="button" onClick={() => controller.open(item.id)}><StudioIcon name="pages" /><span className="studio-content-list__body"><strong>{item.title || '未命名页面'}</strong><small>{item.excerpt || '暂无摘要'}</small><span className="studio-content-list__details"><em>{item.status === 'published' ? '已发布' : '草稿'}</em><span>/blog/pages/{item.slug}</span><time dateTime={item.updated_at}>{item.updated_at.slice(0, 10)}</time></span></span><StudioIcon name="chevron" /></button>) : <div className="studio-post-empty"><StudioIcon name="pages" /><strong>{query || status !== 'all' ? '没有匹配的页面' : '还没有页面'}</strong><p>{query || status !== 'all' ? '换个搜索词，或清除筛选。' : '创建关于、站点说明或专题页面，发布后会出现在公开页面目录中。'}</p><button type="button" onClick={query || status !== 'all' ? () => { update({ q: '', status: 'all', page: '1' }); search.current?.focus() } : controller.create}>{query || status !== 'all' ? '清除筛选' : '创建页面'}</button></div>}
    </div>
    {!error && total > 20 && <nav className="studio-post-pagination" aria-label="页面分页"><button type="button" disabled={loading || page === 1} onClick={() => update({ page: String(page - 1) })}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil(total / 20))} 页</span><button type="button" disabled={loading || page * 20 >= total} onClick={() => update({ page: String(page + 1) })}>下一页</button></nav>}
  </section>
}

export function PagesWorkspace({ token, controller: page, navigationBlocked, onCancelNavigation, onConfirmNavigation }: {
  token: string; controller: PagesController; navigationBlocked: boolean
  onCancelNavigation: () => void; onConfirmNavigation: () => void
}) {
  const title = page.editor.title || '未命名页面'
  return <>
    {!page.resource ? <PagesIndex token={token} controller={page} /> : page.loadError ? <section className="studio-post-empty" role="alert"><strong>页面未能打开</strong><p>{page.loadError}</p><button type="button" onClick={page.retry}>重试打开页面</button><button type="button" onClick={page.back}>返回页面列表</button></section> : !page.ready ? <p role="status">正在打开页面…</p> : page.editing ? <MarkdownEditor kind="page" categories={[]} tags={[]} editor={page.editor} feedback={page.feedback} isSaving={page.busy} onBack={page.back} onChange={page.change} onDelete={page.requestDelete} onUnpublish={page.requestUnpublish} onPreview={page.preview} onSave={page.requestSave} saveState={page.busy ? '正在保存…' : page.dirty ? page.localSaved ? '未保存 · 本标签页已暂存' : '未保存 · 无法暂存' : page.editor.id ? '已与站点同步' : '新页面 · 尚未保存'} recovery={page.recovery} onRestoreDraft={page.restore} onDiscardDraft={page.discard} onCompareVersion={() => void page.compare()} hasVersionConflict={page.conflict} /> : <ArticleReader kind="page" editor={page.editor} onBack={page.back} onEdit={page.edit} />}
    {navigationBlocked ? <BlogWorkflowDialog title={page.busy ? '正在保存页面' : '还有未保存的页面内容'} description={page.busy ? '请等待操作结果，再离开页面。' : page.localSaved ? '当前输入已暂存在本标签页，返回时可以选择恢复。关闭标签页会清除暂存。' : '浏览器无法暂存，请取消并先保存页面。'} confirmLabel="离开写作页" busy={page.busy} onCancel={onCancelNavigation} onConfirm={onConfirmNavigation} /> : page.comparison ? <BlogWorkflowDialog title="核对页面版本" description="保留当前内容后，下次保存将替换展示的站点版本；也可以采用站点版本并丢弃当前修改。" confirmLabel="保留当前内容继续编辑" onCancel={page.cancelComparison} onConfirm={() => page.reconcile(true)}>
      <div className="blog-version-comparison"><details open><summary>当前输入：{title}</summary><pre>{page.editor.contentMarkdown || '正文为空'}</pre></details><details open><summary>站点版本：{page.comparison.title}</summary><pre>{page.comparison.content_markdown || '正文为空'}</pre></details><button type="button" onClick={() => page.reconcile(false)}>采用站点版本，丢弃当前修改</button></div>
    </BlogWorkflowDialog> : page.confirmation && <BlogWorkflowDialog title={page.confirmation === 'delete' ? '删除页面' : page.confirmation === 'unpublish' ? '撤回页面发布' : page.editor.status === 'published' ? '更新已发布页面' : '页面发布前检查'} description={page.confirmation === 'delete' ? `删除「${title}」后，正文和本标签页暂存均无法恢复；不会删除文章或其他页面。` : page.confirmation === 'unpublish' ? `「${title}」将从公开目录移除，原地址不再可访问，正文保留为草稿。未保存的修改也会一起保存为草稿。` : '确认后，页面将公开显示在页面目录中，任何人都可以通过下面的地址访问。'} confirmLabel={page.confirmation === 'delete' ? '确认删除页面' : page.confirmation === 'unpublish' ? '确认撤回发布' : '确认发布页面'} busy={page.busy} error={page.feedback} onCancel={page.cancelConfirmation} onConfirm={() => void (page.confirmation === 'delete' ? page.remove() : page.save(page.confirmation === 'publish' ? 'published' : 'draft'))}>
      <dl><div><dt>标题</dt><dd>{title}</dd></div><div><dt>地址</dt><dd>/blog/pages/{page.editor.slug}</dd></div></dl>
    </BlogWorkflowDialog>}
  </>
}
