import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getBlogPosts, type BlogPostPreview } from '../../lib/api'
import { useModalDialog } from '../../studio/useModalDialog'

type SearchState = { query: string; status: 'loading' | 'ready' | 'error'; items: BlogPostPreview[]; total: number }

export function BlogSearch({ initialQuery, onClose, onSearch }: { initialQuery: string; onClose: () => void; onSearch: (query: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const dialog = useModalDialog(input)
  const [query, setQuery] = useState(initialQuery)
  const [composing, setComposing] = useState(false)
  const [retry, setRetry] = useState(0)
  const [state, setState] = useState<SearchState>({ query: '', status: 'ready', items: [], total: 0 })
  const keyword = query.trim()
  const current = state.query === keyword ? state : { query: keyword, status: 'loading' as const, items: [], total: 0 }

  useEffect(() => {
    if (!keyword || composing) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ query: keyword, status: 'loading', items: [], total: 0 })
      void getBlogPosts(controller.signal, 8, { q: keyword }).then(data => {
        if (!controller.signal.aborted) setState({ query: keyword, status: 'ready', items: data.items, total: data.total })
      }).catch(() => {
        if (!controller.signal.aborted) setState({ query: keyword, status: 'error', items: [], total: 0 })
      })
    }, 300)
    return () => { clearTimeout(timer); controller.abort() }
  }, [keyword, composing, retry])

  return <dialog className="blog-search-dialog" ref={dialog} aria-labelledby="blog-search-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="blog-search-surface">
      <div className="blog-search-heading"><h2 id="blog-search-title">搜索文章</h2><button type="button" aria-label="关闭文章搜索" onClick={onClose}><X size={20} /></button></div>
      <form role="search" aria-label="搜索公开文章" noValidate onSubmit={event => { event.preventDefault(); if (!composing && keyword) onSearch(keyword) }}>
        <div className="blog-search-input"><Search size={20} aria-hidden="true" /><input ref={input} aria-label="搜索文章关键词" placeholder="搜索标题或摘要…" value={query} maxLength={200} onChange={event => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setQuery(event.currentTarget.value); setComposing(false) }} />{query && <button type="button" aria-label="清空文章搜索" onClick={() => { setQuery(''); input.current?.focus() }}><X size={16} /></button>}</div>
        <div className="blog-search-results" aria-live="polite" aria-busy={Boolean(keyword) && current.status === 'loading'}>
          {!keyword ? <p>输入关键词，查找公开文章的标题和摘要。</p> : current.status === 'loading' || composing ? <p role="status">正在搜索文章…</p> : current.status === 'error' ? <div role="alert"><p>搜索暂时不可用，请重试。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新搜索</button></div> : current.items.length === 0 ? <p>没有找到匹配的文章，换个关键词试试。</p> : <><span className="blog-search-count">找到 {current.total} 篇文章</span><ul>{current.items.map(post => <li key={post.id}><Link to={`/articles/${encodeURIComponent(post.slug)}`} state={{ blogReturnTo: `/blog?${new URLSearchParams({ q: keyword })}` }} onClick={onClose}><span>{post.title}</span><ArrowRight size={16} aria-hidden="true" /></Link></li>)}</ul></>}
        </div>
        {keyword && current.status === 'ready' && current.total > 0 && <button className="blog-search-all" type="submit">查看全部搜索结果 <ArrowRight size={16} aria-hidden="true" /></button>}
      </form>
    </div>
  </dialog>
}
