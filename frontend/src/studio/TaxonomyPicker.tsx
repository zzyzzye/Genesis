import { useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import type { BlogTag } from '../lib/api'
import { StudioIcon } from './StudioIcon'
import { taxonomyError, type TaxonomyKind } from './taxonomy'
import './TaxonomyPicker.css'

export function TaxonomyPicker({ kind, items, selected, onSelect, onCreate, disabled = false }: {
  kind: TaxonomyKind
  items: BlogTag[]
  selected: string[]
  onSelect: (item: BlogTag | null) => void
  onCreate: (name: string) => Promise<BlogTag>
  disabled?: boolean
}) {
  const label = kind === 'tags' ? '标签' : '分类'
  const id = useId()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const chosen = items.filter((item) => selected.includes(item.id))
  const matches = items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const exact = items.find((item) => item.name === query.trim())
  const atLimit = kind === 'tags' && selected.length >= 10

  function select(item: BlogTag | null) {
    onSelect(item); setQuery(''); setError(''); setNotice('')
    inputRef.current?.focus()
  }

  async function create() {
    if (pending.current || disabled) return
    const name = query.trim()
    if (!name || name.length > 50) { setError('请输入名称，最多 50 个字符。'); inputRef.current?.focus(); return }
    if (exact && (!atLimit || selected.includes(exact.id))) { select(exact); return }
    if (atLimit) { setError('最多选择 10 个标签，请先移除一个。'); return }
    pending.current = true; setBusy(true); setError('')
    try {
      // 创建回调同时将新项选入当前文章，等待服务端确认后反馈。
      const saved = await onCreate(name)
      setQuery(''); setNotice(`已创建并选择「${saved.name}」。`)
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch (reason) { setError(taxonomyError(reason, '创建失败，请检查网络后重试。')) }
    finally { pending.current = false; setBusy(false) }
  }

  return <section className="taxonomy-picker" aria-labelledby={id + '-title'}>
    <div className="taxonomy-picker__heading"><h3 id={id + '-title'}>{label}</h3><span>{kind === 'tags' ? `${selected.length} / 10` : '单选'}</span></div>
    <div className="taxonomy-picker__selected" aria-label={'已选' + label}>
      {chosen.length ? chosen.map((item) => <button key={item.id} type="button" disabled={disabled || busy} aria-label={'移除' + label + ' ' + item.name} onClick={() => select(kind === 'categories' ? null : item)}>{item.name}<StudioIcon name="close" /></button>) : <span>{kind === 'tags' ? '尚未选择标签' : '暂不分类'}</span>}
    </div>
    <div className="taxonomy-picker__input"><StudioIcon name="search" />
      <input ref={inputRef} aria-label={'搜索或新建' + label} aria-describedby={id + '-feedback'} aria-invalid={!!error} placeholder={'搜索或输入新' + label + '…'} value={query} maxLength={50} disabled={disabled || busy} onChange={(event) => { setQuery(event.target.value); setError(''); setNotice('') }} onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          if (!event.nativeEvent.isComposing && event.keyCode !== 229) void create()
        }
      }} />
      {query && <button type="button" disabled={disabled || busy} aria-label={'清空' + label + '搜索'} onClick={() => { setQuery(''); setError(''); inputRef.current?.focus() }}><StudioIcon name="close" /></button>}
    </div>
    <div className="taxonomy-picker__choices" aria-label={'可选' + label}>
      {kind === 'categories' && !query && <button type="button" aria-pressed={selected.length === 0} disabled={disabled || busy} onClick={() => select(null)}>暂不分类</button>}
      {matches.filter((item) => kind === 'categories' || !selected.includes(item.id)).map((item) => <button key={item.id} type="button" aria-pressed={selected.includes(item.id)} disabled={disabled || busy || (atLimit && !selected.includes(item.id))} onClick={() => select(item)}>{selected.includes(item.id) && <Check />}{item.name}</button>)}
      {query.trim() && !exact && <button className="taxonomy-picker__new" type="button" disabled={disabled || busy || atLimit} onClick={() => void create()}><StudioIcon name="plus" />{busy ? '创建中…' : `创建「${query.trim()}」`}</button>}
      {!items.length && !query && <span>输入名称，创建第一个{label}。</span>}
    </div>
    <div className="taxonomy-picker__feedback" id={id + '-feedback'}>{error ? <p role="alert">{error}</p> : <p role="status">{notice || (atLimit ? '最多选择 10 个标签，移除一个后可继续添加。' : '')}</p>}</div>
  </section>
}
