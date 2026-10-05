import './TaxonomyWorkspace.css'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
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
  const [editing, setEditing] = useState<BlogTag | null>(null)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [removing, setRemoving] = useState<BlogTag | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const slugRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const formId = useId()
  const matches = items.filter((item) => `${item.name} ${item.slug}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const sorted = [...matches].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  useEffect(() => { if (removing) cancelRef.current?.focus() }, [removing])

  function reset() {
    setEditing(null); setName(''); setSlug(''); setError('')
  }

  function cancelRemoval() {
    setRemoving(null); setError('')
    requestAnimationFrame(() => deleteTriggerRef.current?.focus())
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(''); setNotice('')
    if (!name.trim() || name.trim().length > 50) {
      setError('名称不能为空，最多 50 个字符。'); nameRef.current?.focus(); return
    }
    if (kind === 'categories' && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()) || slug.trim().length > 80)) {
      setError('标识使用小写字母、数字和短横线，最多 80 个字符。'); slugRef.current?.focus(); return
    }
    setBusy(true)
    try {
      // 标签标识只用于内部关联，改名时保持稳定，创建时自动生成。
      const data = { name: name.trim(), slug: kind === 'tags' ? editing?.slug ?? `tag-${crypto.randomUUID()}` : slug.trim() }
      const saved = editing ? await updateAdminBlogTaxonomy(token, kind, editing.id, data)
        : kind === 'categories' ? await createAdminBlogCategory(token, data) : await createAdminBlogTag(token, data)
      onChanged(saved, editing)
      reset()
      setNotice(`${label}「${saved.name}」已${editing ? '更新' : '创建'}。`)
      requestAnimationFrame(() => nameRef.current?.focus())
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败，请稍后重试。'
      setError(kind === 'tags' && message.includes('HTTP 409') ? '这个标签名称已存在，可以直接使用已有标签。' : message)
    } finally { setBusy(false) }
  }

  async function remove() {
    if (!removing || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await deleteAdminBlogTaxonomy(token, kind, removing.id)
      onChanged(null, removing)
      if (editing?.id === removing.id) reset()
      setNotice(`${label}「${removing.name}」已删除。`)
      setRemoving(null)
      requestAnimationFrame(() => nameRef.current?.focus())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败，请稍后重试。')
    } finally { setBusy(false) }
  }

  return <section className="studio-taxonomy" aria-label={`${label}管理`}>
    <div className="studio-taxonomy__list">
      <div className="studio-taxonomy__tools">
        <span>{items.length} 个{label}</span>
        <div className="studio-taxonomy__search">
          <StudioIcon name="search" />
          <input ref={searchRef} aria-label={`搜索${label}`} value={query} placeholder={kind === 'tags' ? '搜索标签名称' : '搜索分类名称或标识'} onChange={(event) => { const next = new URLSearchParams(params); if (event.target.value) next.set('q', event.target.value); else next.delete('q'); setParams(next, { replace: true }) }} />
          {query && <button type="button" aria-label={`清空${label}搜索`} onClick={() => { const next = new URLSearchParams(params); next.delete('q'); setParams(next, { replace: true }); searchRef.current?.focus() }}><StudioIcon name="close" /></button>}
        </div>
      </div>
      {sorted.length ? <table>
        <thead><tr><th scope="col">{kind === 'tags' ? '名称' : '名称 / 标识'}</th><th scope="col">文章</th><th scope="col">操作</th></tr></thead>
        <tbody>{sorted.map((item) => <tr key={item.id} className={editing?.id === item.id ? 'is-editing' : ''}>
          <td><strong>{item.name}</strong>{kind === 'categories' && <small>{item.slug}</small>}</td>
          <td>{usage[item.id] ?? 0}</td>
          <td><div className="studio-taxonomy__row-actions">
            <button type="button" disabled={busy || !!removing} aria-label={`编辑${label}：${item.name}`} onClick={() => { setEditing(item); setName(item.name); setSlug(item.slug); setError(''); setNotice(''); nameRef.current?.focus() }}>编辑</button>
            <button type="button" disabled={busy || !!removing || !!usage[item.id]} title={usage[item.id] ? '先在文章设置中移除关联，才能删除' : `删除${label}`} aria-label={`删除${label}：${item.name}`} onClick={(event) => { deleteTriggerRef.current = event.currentTarget; setRemoving(item); setError(''); setNotice('') }}>删除</button>
          </div></td>
        </tr>)}</tbody>
      </table> : <div className="studio-taxonomy__empty"><StudioIcon name={kind === 'categories' ? 'folder' : 'tag'} /><strong>{items.length ? '没有匹配的结果' : `还没有${label}`}</strong><p>{items.length ? '换个关键词，或清空搜索。' : `创建第一个${label}，然后在文章设置中选择它。`}</p></div>}
      <p className="studio-taxonomy__hint">使用中的{label}可以编辑，删除前需先在文章设置中移除关联。</p>
    </div>
    <form className="studio-taxonomy__form" noValidate onSubmit={(event) => void save(event)}>
      <h2>{editing ? `编辑${label}` : `新建${label}`}</h2>
      <p>{kind === 'categories' ? '用分类归纳文章主题，每篇文章选择一个分类。' : '填一个名称就能创建，中文、英文、大小写和符号都可以。'}</p>
      <label htmlFor={`${formId}-name`}>名称</label>
      <input ref={nameRef} id={`${formId}-name`} value={name} maxLength={50} aria-invalid={!!error && !name.trim()} aria-describedby={`${formId}-feedback`} disabled={busy || !!removing} onChange={(event) => setName(event.target.value)} placeholder={kind === 'categories' ? '例如：工程实践' : '例如：React'} />
      {kind === 'categories' && <><label htmlFor={`${formId}-slug`}>标识（Slug）</label>
      <input ref={slugRef} id={`${formId}-slug`} value={slug} maxLength={80} aria-invalid={!!error && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim())} disabled={busy || !!removing} onChange={(event) => setSlug(event.target.value)} aria-describedby={`${formId}-slug-help ${formId}-feedback`} placeholder={kind === 'categories' ? 'engineering' : 'react'} />
      <small id={`${formId}-slug-help`}>使用唯一的小写英文、数字或短横线。</small></>}
      <div className="studio-taxonomy__form-actions"><button type="submit" disabled={busy || !!removing}>{busy ? '处理中…' : editing ? '保存修改' : `创建${label}`}</button>{editing && <button type="button" disabled={busy || !!removing} onClick={reset}>取消编辑</button>}</div>
      {removing && <div className="studio-taxonomy__confirmation" role="group" aria-label={`确认删除${label}`} onKeyDown={(event) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); cancelRemoval() } }}><strong>删除「{removing.name}」？</strong><p>此操作不可恢复，不会删除文章。</p><div><button ref={cancelRef} type="button" disabled={busy} onClick={cancelRemoval}>取消</button><button type="button" disabled={busy} onClick={() => void remove()}>{busy ? '处理中…' : '确认删除'}</button></div></div>}
      <div id={`${formId}-feedback`} className="studio-taxonomy__feedback">{error ? <p role="alert">{error}</p> : <p role="status">{notice}</p>}</div>
    </form>
  </section>
}
