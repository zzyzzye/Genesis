import './styles/posts.css'

import { useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

import type { BlogPostAdmin } from '../lib/api'
import { StudioIcon } from './StudioIcon'

const pageSize = 40

export function PostsIndex({ posts, onCreatePost, onOpenPost }: {
  posts: BlogPostAdmin[]
  onCreatePost: () => void
  onOpenPost: (post: BlogPostAdmin) => void
}) {
  const [params, setParams] = useSearchParams()
  const inputRef = useRef<HTMLInputElement>(null)
  const query = params.get('q') ?? ''
  const status = ['draft', 'published'].includes(params.get('status') ?? '') ? params.get('status')! : 'all'
  const filtered = posts.filter((post) => (status === 'all' || post.status === status) && `${post.title} ${post.excerpt} ${post.category?.name ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)))
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize)

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
          <input ref={inputRef} id="studio-post-search" value={query} onChange={(event) => changeFilter('q', event.target.value)} placeholder="搜索标题、摘要或分类" />
          {query && <button type="button" aria-label="清空文章搜索" onClick={() => { changeFilter('q', ''); inputRef.current?.focus() }}><StudioIcon name="close" /></button>}
        </label>
        <button className="new-post-button" type="button" onClick={onCreatePost}><StudioIcon name="plus" />新建文章</button>
      </div>
      <div className="studio-post-index__filters" aria-label="文章筛选">
        {([['all', '全部'], ['draft', '草稿'], ['published', '已发布']] as const).map(([value, label]) => <button key={value} type="button" className={status === value ? 'is-active' : ''} aria-pressed={status === value} onClick={() => changeFilter('status', value)}>{label}</button>)}
        <span className="studio-post-count" role="status">共 {filtered.length} 篇 · 最近更新</span>
      </div>
      <div className="studio-content-list">
        {visible.map((post) => (
          <button className="studio-content-list__item" key={post.id} type="button" onClick={() => onOpenPost(post)}>
            <StudioIcon name="articles" />
            <span className="studio-content-list__body">
              <strong>{post.title}</strong>
              <small>{post.excerpt || '暂无摘要'}</small>
              <span className="studio-content-list__details"><em>{post.status === 'published' ? '已发布' : '草稿'}</em><span>{post.category?.name ?? '未分类'}</span><time dateTime={post.updated_at}>{post.updated_at.slice(0, 10)}</time></span>
            </span>
            <StudioIcon name="chevron" />
          </button>
        ))}
        {visible.length === 0 && <div className="studio-post-empty"><StudioIcon name="articles" /><strong>{posts.length === 0 ? '还没有文章' : '没有匹配的文章'}</strong><p>{posts.length === 0 ? '创建第一篇草稿，开始记录你的想法。' : '试试其他关键词，或切换文章状态。'}</p><button type="button" onClick={posts.length === 0 ? onCreatePost : () => { const next = new URLSearchParams(params); next.delete('q'); next.delete('status'); next.delete('page'); setParams(next, { replace: true }); inputRef.current?.focus() }}>{posts.length === 0 ? '创建文章' : '清除筛选'}</button></div>}
      </div>
      {pages > 1 && <nav className="studio-post-pagination" aria-label="文章分页"><button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>上一页</button><span>{page} / {pages}</span><button type="button" disabled={page === pages} onClick={() => changePage(page + 1)}>下一页</button></nav>}
    </section>
  )
}
