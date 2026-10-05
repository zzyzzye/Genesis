import './TaxonomyWorkspace.css'
import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createAdminBlogCategory, createAdminBlogTag, deleteAdminBlogTaxonomy, updateAdminBlogTaxonomy, type BlogTag } from '../lib/api'
import { StudioIcon } from './StudioIcon'

export function TaxonomyWorkspace({ kind, items, usage, token, onChanged }: {
  kind: 'categories' | 'tags'
  items: BlogTag[]
  usage: Record<string, number>
  token: string
  onChanged: (saved: BlogTag | null, previous: BlogTag | null) => void
}) {
  const label = kind === 'categories' ? '分类' : '标签'
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<BlogTag | null>(null)
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pendingRef = useRef(false)
  const [highlighted, setHighlighted] = useState<string | null>(null)
  const [removing, setRemoving] = useState<BlogTag | null>(null)
  const [removeError, setRemoveError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const editRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const nameButtons = useRef(new Map<string, HTMLButtonElement>())
  const formId = useId()
  const sorted = items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  useEffect(() => { if (removing) cancelRef.current?.focus() }, [removing])
  useEffect(() => { if (editing) { editRef.current?.focus(); editRef.current?.select() } }, [editing])

  function clearSearch() {
    const next = new URLSearchParams(params)
    next.delete('q')
    setParams(next, { replace: true })
  }

  function locate(item: BlogTag) {
    clearSearch(); setHighlighted(item.id)
    requestAnimationFrame(() => {
      const button = nameButtons.current.get(item.id)
      button?.scrollIntoView({ block: 'nearest' }); button?.focus()
    })
  }

  function cancelEditing() {
    if (pendingRef.current) return
    const id = editing?.id
    setEditing(null); setEditError('')
    requestAnimationFrame(() => { if (id) nameButtons.current.get(id)?.focus() })
  }

  function beginEditing(item: BlogTag) {
    if (pendingRef.current || removing) return
    setEditing(item); setEditName(item.name); setEditError(''); setError(''); setNotice(''); setHighlighted(item.id)
  }

  async function create(event: FormEvent) {
    event.preventDefault()
    if (pendingRef.current || editing || removing) return
    setError(''); setNotice('')
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 50) {
      setError('请输入名称，最多 50 个字符。'); nameRef.current?.focus(); return
    }
    const existing = items.find((item) => item.name === trimmed)
    if (existing) {
      setName(''); setNotice('「' + existing.name + '」已存在，已为你定位。'); locate(existing); return
    }
    pendingRef.current = true; setBusy(true)
    try {
      // 标识自动生成，改名时保持稳定，避免影响已有文章关联。
      const data = { name: trimmed, slug: (kind === 'tags' ? 'tag-' : 'category-') + crypto.randomUUID() }
      const saved = kind === 'categories' ? await createAdminBlogCategory(token, data) : await createAdminBlogTag(token, data)
      onChanged(saved, null)
      clearSearch(); setName(''); setHighlighted(saved.id); setNotice(label + '「' + saved.name + '」已添加。')
      requestAnimationFrame(() => nameRef.current?.focus())
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '添加失败，请稍后重试。'
      setError(message.includes('HTTP 409') ? '这个名称已存在，请搜索已有项，或刷新列表后重试。' : message)
    } finally { pendingRef.current = false; setBusy(false) }
  }

  async function saveEditing() {
    if (!editing || pendingRef.current) return
    setEditError('')
    const trimmed = editName.trim()
    if (!trimmed || trimmed.length > 50) {
      setEditError('请输入名称，最多 50 个字符。'); editRef.current?.focus(); return
    }
    if (items.some((item) => item.id !== editing.id && item.name === trimmed)) {
      setEditError('这个名称已存在，请换一个名称。'); editRef.current?.focus(); return
    }
    if (trimmed === editing.name) { cancelEditing(); return }
    pendingRef.current = true; setBusy(true)
    try {
      const saved = await updateAdminBlogTaxonomy(token, kind, editing.id, { name: trimmed, slug: editing.slug })
      onChanged(saved, editing)
      setEditing(null); setNotice(label + '「' + saved.name + '」已更新。'); locate(saved)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败，请稍后重试。'
      setEditError(message.includes('HTTP 409') ? '这个名称已存在，请换一个名称。' : message)
    } finally { pendingRef.current = false; setBusy(false) }
  }

  function cancelRemoval() {
    if (pendingRef.current) return
    setRemoving(null); setRemoveError('')
    requestAnimationFrame(() => deleteTriggerRef.current?.focus())
  }

  async function remove() {
    if (!removing || pendingRef.current) return
    pendingRef.current = true; setBusy(true); setRemoveError(''); setNotice('')
    try {
      await deleteAdminBlogTaxonomy(token, kind, removing.id)
      onChanged(null, removing)
      setNotice(label + '「' + removing.name + '」已删除。'); setRemoving(null)
      requestAnimationFrame(() => nameRef.current?.focus())
    } catch (reason) {
      setRemoveError(reason instanceof Error ? reason.message : '删除失败，请稍后重试。')
    } finally { pendingRef.current = false; setBusy(false) }
  }

  return <section className="studio-taxonomy" aria-label={label + '管理'}>
    <form className="studio-taxonomy__create" noValidate onSubmit={(event) => void create(event)}>
      <label htmlFor={formId + '-name'}>新增{label}</label>
      <div className="studio-taxonomy__create-controls">
        <input ref={nameRef} id={formId + '-name'} aria-label="名称" value={name} maxLength={50} aria-invalid={!!error} aria-describedby={formId + '-help ' + formId + '-feedback'} disabled={busy || !!editing || !!removing} onChange={(event) => { setName(event.target.value); setError('') }} onKeyDown={(event) => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault() }} placeholder={'输入' + label + '名称，按 Enter 添加'} />
        <button type="submit" disabled={busy || !!editing || !!removing}>{busy && !editing && !removing ? '添加中…' : '添加'}</button>
      </div>
      <small id={formId + '-help'}>中文、英文和符号都可以。点名称直接修改，Enter 保存，Esc 取消。</small>
      <div id={formId + '-feedback'} className="studio-taxonomy__feedback">{error ? <p role="alert">{error}</p> : <p role="status">{notice}</p>}</div>
    </form>
    <div className="studio-taxonomy__list">
      <div className="studio-taxonomy__tools">
        <span>{items.length} 个{label}</span>
        <div className="studio-taxonomy__search">
          <StudioIcon name="search" />
          <input ref={searchRef} aria-label={'搜索' + label} value={query} placeholder={'搜索' + label + '名称'} disabled={!!editing || !!removing || busy} onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); setParams(next, { replace: true }) }} />
          {query && <button type="button" aria-label={'清空' + label + '搜索'} disabled={!!editing || !!removing || busy} onClick={() => { clearSearch(); searchRef.current?.focus() }}><StudioIcon name="close" /></button>}
        </div>
      </div>
      {sorted.length ? <table>
        <thead><tr><th scope="col">名称</th><th scope="col">文章</th><th scope="col">操作</th></tr></thead>
        <tbody>{sorted.map((item) => <Fragment key={item.id}>
          <tr className={highlighted === item.id ? 'is-highlighted' : ''}>
            <td>{editing?.id === item.id ? <>
              <input ref={editRef} className="studio-taxonomy__edit-input" aria-label={'修改' + label + '名称'} aria-invalid={!!editError} aria-describedby={formId + '-edit-error'} value={editName} maxLength={50} disabled={busy} onChange={(event) => { setEditName(event.target.value); setEditError('') }} onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return
                if (event.key === 'Enter') { event.preventDefault(); void saveEditing() }
                if (event.key === 'Escape') { event.preventDefault(); cancelEditing() }
              }} />
              <div id={formId + '-edit-error'} className="studio-taxonomy__edit-error">{editError && <p role="alert">{editError}</p>}</div>
            </> : <button ref={(element) => { if (element) nameButtons.current.set(item.id, element); else nameButtons.current.delete(item.id) }} className="studio-taxonomy__name" type="button" aria-label={'编辑' + label + '：' + item.name} disabled={busy || !!removing || !!editing} onClick={() => beginEditing(item)}>{item.name}</button>}</td>
            <td>{usage[item.id] ?? 0}</td>
            <td><div className="studio-taxonomy__row-actions">
              {editing?.id === item.id ? <><button type="button" disabled={busy} onClick={() => void saveEditing()}>{busy ? '保存中…' : '保存'}</button><button type="button" disabled={busy} onClick={cancelEditing}>取消</button></>
                : <button type="button" disabled={busy || !!removing || !!editing || !!usage[item.id]} title={usage[item.id] ? '先在文章设置中移除关联，才能删除' : '删除' + label} aria-label={'删除' + label + '：' + item.name} onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setRemoving(item); setRemoveError(''); setNotice('') }}>删除</button>}
            </div></td>
          </tr>
          {removing?.id === item.id && <tr><td colSpan={3}><div className="studio-taxonomy__confirmation" role="group" aria-label={'确认删除' + label} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelRemoval() } }}><strong>删除「{removing.name}」？</strong><p>此操作不可恢复，不会删除文章。</p><div><button ref={cancelRef} type="button" disabled={busy} onClick={cancelRemoval}>取消</button><button type="button" disabled={busy} onClick={() => void remove()}>{busy ? '删除中…' : '确认删除'}</button></div>{removeError && <p role="alert">{removeError}</p>}</div></td></tr>}
        </Fragment>)}</tbody>
      </table> : <div className="studio-taxonomy__empty"><StudioIcon name={kind === 'categories' ? 'folder' : 'tag'} /><strong>{items.length ? '没有匹配的结果' : '还没有' + label}</strong><p>{items.length ? '换个关键词，或清空搜索。' : '在上方输入名称，添加第一个' + label + '。'}</p></div>}
      <p className="studio-taxonomy__hint">使用中的{label}可以改名，删除前需先在文章设置中移除关联。</p>
    </div>
  </section>
}
