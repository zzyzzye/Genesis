import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { deleteAdminBlogLink, getAdminBlogLinks, saveAdminBlogLink, type BlogLink, type BlogLinkWrite } from '../lib/api'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'
import { StudioIcon } from './StudioIcon'
import { useModalDialog } from './useModalDialog'
import './LinksWorkspace.css'

function errorMessage(reason: unknown) { return reason instanceof Error ? reason.message : '操作失败，请检查网络后重试。' }

function LinkEditor({ item, token, onClose, onSaved, onDirtyChange, onPendingChange, navigationBlocked, onCancelNavigation, onConfirmNavigation }: {
  item: BlogLink | null; token: string; onClose: () => void; onSaved: (saved: BlogLink) => void
  onDirtyChange: (dirty: boolean) => void; onPendingChange: (pending: boolean) => void
  navigationBlocked: boolean; onCancelNavigation: () => void; onConfirmNavigation: () => void
}) {
  const initial: BlogLinkWrite = item ?? { name: '', url: '', description: '', sort_order: 0, is_visible: false }
  const [data, setData] = useState(initial)
  const [order, setOrder] = useState(String(initial.sort_order))
  const [busy, setBusy] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const dialog = useModalDialog(input)
  const pending = useRef(false)
  const id = useId()
  const dirty = ['name', 'url', 'description', 'is_visible'].some((key) => data[key as keyof BlogLinkWrite] !== initial[key as keyof BlogLinkWrite]) || order !== String(initial.sort_order)
  const discard = discarding || navigationBlocked
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => () => onPendingChange(false), [onPendingChange])
  useEffect(() => { if (discard) dialog.current?.querySelector<HTMLButtonElement>('[data-keep-editing]')?.focus(); else input.current?.focus() }, [discard, dialog])

  function change<K extends keyof BlogLinkWrite>(key: K, value: BlogLinkWrite[K]) { setData((current) => ({ ...current, [key]: value })); setErrors({}); setError('') }
  function cancelDiscard() { setDiscarding(false); if (navigationBlocked) onCancelNavigation() }
  function close() { if (pending.current) return; if (dirty) setDiscarding(true); else onClose() }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const next = { ...data, name: data.name.trim(), description: data.description.trim(), url: data.url.trim(), sort_order: Number(order) }
    const invalid: Record<string, string> = {}
    if (!next.name || next.name.length > 80) invalid.name = '请输入链接名称，最多 80 个字符。'
    try {
      const url = new URL(next.url)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || next.url.length > 2048) throw new Error()
    } catch { invalid.url = '请输入完整的 http 或 https 链接，且不能包含账号或密码。' }
    if (next.description.length > 240) invalid.description = '说明最多 240 个字符。'
    if (!order.trim() || !Number.isInteger(next.sort_order) || next.sort_order < 0 || next.sort_order > 9999) invalid.sort_order = '排序请输入 0–9999 的整数，数字越小越靠前。'
    setErrors(invalid); setError('')
    if (Object.keys(invalid).length) { requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()); return }
    pending.current = true; setBusy(true); onPendingChange(true)
    try { onSaved(await saveAdminBlogLink(token, next, item)) }
    catch (reason) { setError(errorMessage(reason)) }
    finally { pending.current = false; setBusy(false); onPendingChange(false) }
  }

  function field(key: string) { return { 'aria-invalid': Boolean(errors[key]), 'aria-describedby': id + '-' + key + '-error' } }
  return <dialog ref={dialog} className="blog-link-editor" aria-labelledby={id + '-title'} aria-describedby={id + '-help'} aria-busy={busy} onCancel={(event) => { event.preventDefault(); if (discard) cancelDiscard(); else close() }}>
    <h2 id={id + '-title'}>{discard ? '放弃未保存的链接？' : item ? '编辑链接' : '新增链接'}</h2>
    {discard ? <><p id={id + '-help'}>{busy ? '正在保存，请等待操作完成。' : '本次修改尚未保存，离开后将丢失。'}</p><footer><button type="button" data-keep-editing disabled={busy} onClick={cancelDiscard}>继续编辑</button><button type="button" disabled={busy} onClick={() => { onDirtyChange(false); if (navigationBlocked) onConfirmNavigation(); else onClose() }}>放弃修改</button></footer></> : <form noValidate onSubmit={(event) => void save(event)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }}>
      <p id={id + '-help'}>隐藏链接仅作者可见。勾选公开后，名称、地址和说明会展示在博客中。</p>
      <label htmlFor={id + '-name'}>名称</label><input ref={input} id={id + '-name'} maxLength={80} value={data.name} disabled={busy} onChange={(event) => change('name', event.target.value)} {...field('name')} /><span id={id + '-name-error'}>{errors.name}</span>
      <label htmlFor={id + '-url'}>链接地址</label><input id={id + '-url'} type="url" maxLength={2048} placeholder="https://example.com" value={data.url} disabled={busy} onChange={(event) => change('url', event.target.value)} {...field('url')} /><span id={id + '-url-error'}>{errors.url}</span>
      <label htmlFor={id + '-description'}>说明（可选）</label><textarea id={id + '-description'} rows={3} maxLength={240} value={data.description} disabled={busy} onChange={(event) => change('description', event.target.value)} {...field('description')} /><span id={id + '-description-error'}>{errors.description}</span>
      <label htmlFor={id + '-order'}>排序</label><input id={id + '-order'} type="number" min={0} max={9999} step={1} value={order} disabled={busy} onChange={(event) => { setOrder(event.target.value); setErrors({}) }} {...field('sort_order')} /><span id={id + '-sort_order-error'}>{errors.sort_order || '数字越小越靠前，相同时按名称排列。'}</span>
      <label className="blog-link-editor__visibility"><input type="checkbox" checked={data.is_visible} disabled={busy} onChange={(event) => change('is_visible', event.target.checked)} />在公开博客显示</label>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={close}>取消</button><button type="submit" className="blog-links__primary" disabled={busy}>{busy ? '保存中…' : '保存链接'}</button></footer>
    </form>}
  </dialog>
}

export function LinksWorkspace({ token, onDirtyChange, onPendingChange, navigationBlocked, onCancelNavigation, onConfirmNavigation }: {
  token: string; onDirtyChange: (dirty: boolean) => void; onPendingChange: (pending: boolean) => void
  navigationBlocked: boolean; onCancelNavigation: () => void; onConfirmNavigation: () => void
}) {
  const [params, setParams] = useSearchParams()
  const query = (params.get('q') ?? '').slice(0, 200)
  const visibility = ['public', 'hidden'].includes(params.get('visibility') ?? '') ? params.get('visibility')! : 'all'
  const parsedPage = Number(params.get('page') ?? '1')
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const [items, setItems] = useState<BlogLink[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState<BlogLink | null | undefined>()
  const [deleting, setDeleting] = useState<BlogLink | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const [busy, setBusy] = useState(false)
  const [composing, setComposing] = useState(false)
  const pending = useRef(false)
  const search = useRef<HTMLInputElement>(null)
  const create = useRef<HTMLButtonElement>(null)
  const focusAfterRefresh = useRef(false)

  useLayoutEffect(() => {
    if (!loading && focusAfterRefresh.current) {
      focusAfterRefresh.current = false
      search.current?.focus()
    }
  }, [items, loading])

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
      void getAdminBlogLinks(token, query, page, visibility, controller.signal).then((data) => {
        if (controller.signal.aborted) return
        const maxPage = Math.max(1, Math.ceil(data.total / 20))
        if (page > maxPage) { setParams((current) => { const next = new URLSearchParams(current); if (maxPage === 1) next.delete('page'); else next.set('page', String(maxPage)); return next }, { replace: true }); return }
        setItems(data.items); setTotal(data.total)
      }).catch((reason) => { if (!controller.signal.aborted) setError(errorMessage(reason)) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 300)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [token, query, page, visibility, refresh, composing, setParams])

  function closeEditor() { setEditing(undefined); onDirtyChange(false) }
  async function remove() {
    if (pending.current || !deleting) return
    pending.current = true; setBusy(true); setDeleteError(''); onPendingChange(true)
    try { await deleteAdminBlogLink(token, deleting); focusAfterRefresh.current = true; setLoading(true); setNotice('已删除「' + deleting.name + '」。'); setDeleting(null); setRefresh((value) => value + 1) }
    catch (reason) { setDeleteError(errorMessage(reason)) }
    finally { pending.current = false; setBusy(false); onPendingChange(false) }
  }

  return <section className="blog-links-workspace" aria-label="链接管理">
    <header><div><h2>站点链接 <span>{total}</span></h2><p>整理常用网站与推荐阅读，数字越小越靠前。</p></div><button ref={create} className="blog-links__primary" type="button" onClick={() => setEditing(null)}>新增链接</button></header>
    <div className="blog-links__search"><StudioIcon name="search" /><input ref={search} aria-label="搜索链接" placeholder="搜索名称、说明或地址" maxLength={200} value={query} onChange={(event) => update({ q: event.target.value, page: '1' })} onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)} />{query && <button type="button" aria-label="清空链接搜索" onClick={() => { update({ q: '', page: '1' }); search.current?.focus() }}><StudioIcon name="close" /></button>}</div>
    <div className="blog-links__filters" aria-label="链接可见状态">{([['all', '全部'], ['public', '公开'], ['hidden', '隐藏']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={visibility === value} onClick={() => update({ visibility: value, page: '1' })}>{label}</button>)}<button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>刷新列表</button></div>
    <p className="blog-links__notice" role="status">{notice}</p>
    <div className="blog-links__content" aria-busy={loading}>
      {loading ? <p role="status">正在加载链接…</p> : error ? <div role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>重新加载</button></div> : items.length === 0 ? <div className="blog-links__empty"><StudioIcon name="link" /><h3>{query || visibility !== 'all' ? '没有匹配的链接' : '还没有站点链接'}</h3><p>{query || visibility !== 'all' ? '换一个搜索词，或清除筛选。' : '新增第一个链接，保存后可选择在博客公开。'}</p>{(query || visibility !== 'all') && <button type="button" onClick={() => update({ q: '', visibility: 'all', page: '1' })}>清除筛选</button>}</div> : <ul aria-label="链接列表">{items.map((item) => <li key={item.id}>
        <button className="blog-links__item" type="button" aria-label={'编辑链接：' + item.name} aria-haspopup="dialog" onClick={() => setEditing(item)}><span className="blog-links__order">{item.sort_order}</span><span><strong>{item.name}</strong><small>{item.url}</small>{item.description && <p>{item.description}</p>}</span><span className="blog-links__state">{item.is_visible ? '公开' : '隐藏'}</span></button>
        <div className="blog-links__actions"><a href={item.url} target="_blank" rel="noopener noreferrer" aria-label={'打开链接：' + item.name}>访问 ↗</a><button type="button" aria-label={'删除链接：' + item.name} onClick={() => { setDeleting(item); setDeleteError('') }}>删除</button></div>
      </li>)}</ul>}
    </div>
    {!error && total > 20 && <nav className="blog-links__pagination" aria-label="链接分页"><button type="button" disabled={page === 1 || loading} onClick={() => update({ page: String(page - 1) })}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil(total / 20))} 页 · {total} 个链接</span><button type="button" disabled={page * 20 >= total || loading} onClick={() => update({ page: String(page + 1) })}>下一页</button></nav>}
    {editing !== undefined && <LinkEditor item={editing} token={token} onClose={closeEditor} onSaved={(saved) => { focusAfterRefresh.current = true; setLoading(true); closeEditor(); update({ q: '', visibility: 'all', page: '1' }); setRefresh((value) => value + 1); setNotice('已保存「' + saved.name + '」。' + (saved.is_visible ? '链接已公开。' : '链接仅作者可见。')) }} onDirtyChange={onDirtyChange} onPendingChange={onPendingChange} navigationBlocked={navigationBlocked} onCancelNavigation={onCancelNavigation} onConfirmNavigation={onConfirmNavigation} />}
    {deleting && <BlogWorkflowDialog title="删除链接" description={'删除「' + deleting.name + '」后无法恢复，公开博客也将移除此链接。不会影响文章和目标网站。'} confirmLabel="确认删除" busy={busy} error={deleteError} onCancel={() => { if (!pending.current) setDeleting(null) }} onConfirm={() => void remove()} />}
  </section>
}
