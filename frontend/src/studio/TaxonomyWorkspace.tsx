import './TaxonomyWorkspace.css'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { deleteAdminBlogTaxonomy, updateAdminBlogTaxonomy, type BlogTag } from '../lib/api'
import { StudioIcon } from './StudioIcon'
import { createTaxonomy, taxonomyError, type TaxonomyKind } from './taxonomy'
import { useModalDialog } from './useModalDialog'

function TaxonomyEditor({ item, kind, items, count, token, onSaved, onDeleted, onClose }: {
  item: BlogTag
  kind: TaxonomyKind
  items: BlogTag[]
  count: number
  token: string
  onSaved: (saved: BlogTag) => void
  onDeleted: () => void
  onClose: () => void
}) {
  const label = kind === 'tags' ? '标签' : '分类'
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const dialog = useModalDialog(input)
  const cancel = useRef<HTMLButtonElement>(null)
  const pending = useRef(false)
  const [name, setName] = useState(item.name)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (removing) cancel.current?.focus(); else input.current?.focus() }, [removing])

  function close() { if (!pending.current) onClose() }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    const trimmed = name.trim()
    setError('')
    if (!trimmed || trimmed.length > 50) { setError('请输入名称，最多 50 个字符。'); input.current?.focus(); return }
    if (items.some((other) => other.id !== item.id && other.name === trimmed)) { setError('名称已存在，请换一个名称。'); return }
    if (trimmed === item.name) { close(); return }
    pending.current = true; setBusy(true)
    try { onSaved(await updateAdminBlogTaxonomy(token, kind, item.id, { name: trimmed, slug: item.slug })) }
    catch (reason) { setError(taxonomyError(reason, '保存失败，请检查网络后重试。')) }
    finally { pending.current = false; setBusy(false) }
  }

  async function remove() {
    if (pending.current || count) return
    pending.current = true; setBusy(true); setError('')
    try { await deleteAdminBlogTaxonomy(token, kind, item.id); onDeleted() }
    catch (reason) { setError(taxonomyError(reason, '删除失败，请稍后重试。')) }
    finally { pending.current = false; setBusy(false) }
  }

  return <dialog ref={dialog} className="taxonomy-editor" aria-labelledby={id + '-title'} onCancel={(event) => { event.preventDefault(); if (removing && !pending.current) { setRemoving(false); setError('') } else close() }} onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <div className="taxonomy-editor__surface">
      <header><h2 id={id + '-title'}>{removing ? '删除' : '编辑'}{label}</h2><button type="button" aria-label={'关闭' + label + '编辑'} disabled={busy} onClick={close}><StudioIcon name="close" /></button></header>
      {removing ? <div className="taxonomy-editor__remove"><strong>删除「{item.name}」？</strong><p>此操作不可恢复，不会删除文章。</p><div><button ref={cancel} type="button" disabled={busy} onClick={() => { setRemoving(false); setError('') }}>取消</button><button className="taxonomy-editor__danger" type="button" disabled={busy} onClick={() => void remove()}>{busy ? '删除中…' : '确认删除'}</button></div></div>
        : <form noValidate onSubmit={(event) => void save(event)}>
          <label htmlFor={id + '-name'}>名称</label><input ref={input} id={id + '-name'} aria-label={'修改' + label + '名称'} aria-invalid={!!error} aria-describedby={id + '-feedback'} value={name} maxLength={50} disabled={busy} onChange={(event) => { setName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }} />
          <p className="taxonomy-editor__usage">{count ? '用于 ' + count + ' 篇文章，改名不会影响关联。' : '尚未用于文章。'}</p>
          <footer><button type="button" className="taxonomy-editor__danger" disabled={busy || !!count} title={count ? '先移除文章关联，才能删除' : undefined} onClick={() => { setRemoving(true); setError('') }}>删除{label}</button><div><button type="button" disabled={busy} onClick={close}>取消</button><button className="taxonomy-editor__save" type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button></div></footer>
        </form>}
      <div id={id + '-feedback'} className="taxonomy-editor__feedback">{error && <p role="alert">{error}</p>}</div>
    </div>
  </dialog>
}

export function TaxonomyWorkspace({ kind, items, usage, token, onChanged }: {
  kind: TaxonomyKind
  items: BlogTag[]
  usage: Record<string, number>
  token: string
  onChanged: (saved: BlogTag | null, previous: BlogTag | null) => void
}) {
  const label = kind === 'tags' ? '标签' : '分类'
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [editing, setEditing] = useState<BlogTag | null>(null)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [limit, setLimit] = useState(40)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const id = useId()
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const matches = sorted.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const exact = items.find((item) => item.name === query.trim())

  function changeQuery(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value); else next.delete('q')
    setParams(next, { replace: true }); setLimit(40); setError(''); setNotice('')
  }

  function focusItem(item: BlogTag) {
    changeQuery(''); setHighlighted(item.id)
    setLimit(Math.max(40, sorted.findIndex((other) => other.id === item.id) + 1))
    requestAnimationFrame(() => { const button = buttons.current.get(item.id); button?.scrollIntoView({ block: 'nearest' }); button?.focus() })
  }

  function closeEditor() {
    const item = editing
    setEditing(null)
    requestAnimationFrame(() => { if (item) buttons.current.get(item.id)?.focus() })
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (pending.current) return
    setError(''); setNotice('')
    const name = query.trim()
    if (!name || name.length > 50) { setError('请输入名称，最多 50 个字符。'); input.current?.focus(); return }
    if (exact) { focusItem(exact); setNotice('「' + exact.name + '」已存在。'); return }
    pending.current = true; setBusy(true)
    try {
      const saved = await createTaxonomy(token, kind, name)
      onChanged(saved, null)
      changeQuery(''); setHighlighted(saved.id); setNotice('已创建「' + saved.name + '」。')
      requestAnimationFrame(() => input.current?.focus())
    } catch (reason) { setError(taxonomyError(reason, '创建失败，请检查网络后重试。')) }
    finally { pending.current = false; setBusy(false) }
  }

  return <section className="studio-taxonomy" aria-label={label + '管理'}>
    <header className="studio-taxonomy__header"><div><h2>{kind === 'tags' ? '所有标签' : '所有分类'}<span>{items.length}</span></h2><p>{kind === 'tags' ? '关键词可以自由组合，一篇文章可选多个标签。' : '用主题整理文章，每篇文章选择一个分类。'}</p></div><span className="studio-taxonomy__tip">点击名称管理</span></header>
    <form className="studio-taxonomy__command" noValidate onSubmit={(event) => void create(event)}>
      <div className="studio-taxonomy__input"><StudioIcon name="search" /><input ref={input} aria-label={'搜索或新建' + label} aria-invalid={!!error} aria-describedby={id + '-feedback'} value={query} maxLength={50} disabled={busy} placeholder={'搜索' + label + '，或输入新名称…'} onChange={(event) => changeQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }} />{query && <button type="button" disabled={busy} aria-label={'清空' + label + '搜索'} onClick={() => { changeQuery(''); input.current?.focus() }}><StudioIcon name="close" /></button>}</div>
      <button className="studio-taxonomy__add" type="submit" disabled={busy || !query.trim()}>{busy ? '创建中…' : exact ? '定位' : '新建' + label}</button>
    </form>
    <div id={id + '-feedback'} className="studio-taxonomy__feedback">{error ? <p role="alert">{error}</p> : <p role="status">{notice || (query.trim() && !exact ? '按 Enter 创建「' + query.trim() + '」' : '')}</p>}</div>
    {matches.length ? <ul className={'studio-taxonomy__items studio-taxonomy__items--' + kind} aria-label={label + '列表'}>
      {matches.slice(0, limit).map((item) => <li key={item.id}><button ref={(element) => { if (element) buttons.current.set(item.id, element); else buttons.current.delete(item.id) }} type="button" className={highlighted === item.id ? 'is-highlighted' : ''} aria-label={'编辑' + label + '：' + item.name} aria-haspopup="dialog" disabled={busy} onClick={() => { setEditing(item); setNotice('') }}>
        {kind === 'categories' && <StudioIcon name="folder" />}<span className="studio-taxonomy__item-name">{item.name}</span><span className="studio-taxonomy__count" title={(usage[item.id] ?? 0) + ' 篇文章'}>{usage[item.id] ?? 0}{kind === 'categories' && ' 篇文章'}</span>{kind === 'categories' && <StudioIcon name="chevron" />}
      </button></li>)}
    </ul> : <div className="studio-taxonomy__empty"><StudioIcon name={kind === 'tags' ? 'tag' : 'folder'} /><strong>{query ? '还没有「' + query.trim() + '」' : '还没有' + label}</strong><p>{query ? '按 Enter 即可创建，也可以换一个词搜索。' : '在上方输入名称，创建第一个' + label + '。'}</p></div>}
    {matches.length > limit && <button className="studio-taxonomy__more" type="button" onClick={() => setLimit(limit + 40)}>显示更多（剩余 {matches.length - limit} 个）</button>}
    {editing && <TaxonomyEditor key={editing.id} item={editing} kind={kind} items={items} count={usage[editing.id] ?? 0} token={token} onClose={closeEditor} onSaved={(saved) => { onChanged(saved, editing); setEditing(null); focusItem(saved); setNotice('已更新「' + saved.name + '」。') }} onDeleted={() => { onChanged(null, editing); setEditing(null); setNotice('已删除「' + editing.name + '」。'); requestAnimationFrame(() => input.current?.focus()) }} />}
  </section>
}
