import './BlogDirectory.css'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, CornerUpLeft, FileText, Home, Menu, Search, Tag, UserRound, X } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { getBlogPosts, getPublicBlogTags, type BlogPostPreview, type PublicBlogTag } from '../../lib/api'
import { useModalDialog } from '../../studio/useModalDialog'
import { BlogLinks } from './BlogLinks'
import { BlogSearch } from './BlogSearch'

type DirectoryState = { key: string; status: 'loading' | 'ready' | 'error'; items: BlogPostPreview[]; total: number }
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
const pageSize = 12

function fallbackCover(post: BlogPostPreview): string {
  const topic = `${post.slug} ${post.title} ${post.tags.map(tag => tag.name).join(' ')}`.toLowerCase()
  if (/写作|文字|writing/.test(topic)) return '/images/blog/writing.jpg'
  if (/python|工程|技术|模块|code|module/.test(topic)) return '/images/blog/architecture.jpg'
  return '/images/blog/forest.jpg'
}

function Cover({ post, featured = false }: { post: BlogPostPreview; featured?: boolean }) {
  const [failed, setFailed] = useState(false)
  return <img src={!failed && post.cover_image_url ? post.cover_image_url : fallbackCover(post)} alt="" width={1587} height={992} loading={featured ? 'eager' : 'lazy'} fetchPriority={featured ? 'high' : 'auto'} onError={() => setFailed(true)} />
}

function Author({ post }: { post: BlogPostPreview }) {
  const [failed, setFailed] = useState(false)
  return <span className="portal-author">{post.author.avatar_url && !failed ? <img src={post.author.avatar_url} alt="" width={28} height={28} onError={() => setFailed(true)} /> : <span className="portal-author-avatar" aria-hidden="true">{post.author.display_name.slice(0, 1).toUpperCase()}</span>}<span>{post.author.display_name}</span></span>
}

function Navigation({ tags, activeTag, error, onTag, onRetry, onNavigate }: { tags: PublicBlogTag[]; activeTag: string; error: boolean; onTag: (slug: string) => void; onRetry: () => void; onNavigate?: () => void }) {
  return <>
    <nav className="portal-navigation" aria-label="博客导航">
      <Link to="/blog" className="is-active" aria-label="博客首页" onClick={onNavigate}><Home size={19} /><span>首页</span></Link>
      <a href="#articles" aria-label="文章" title="文章" onClick={onNavigate}><BookOpen size={19} /><span>文章</span></a>
      <Link to="/blog/pages" aria-label="页面" title="页面" onClick={onNavigate}><FileText size={19} /><span>页面</span></Link>
      <Link to="/account" aria-label="我的账户" title="我的账户" onClick={onNavigate}><UserRound size={19} /><span>我的账户</span></Link>
      <Link to="/" aria-label="返回 Genesis" title="返回 Genesis" onClick={onNavigate}><CornerUpLeft size={19} /><span>返回 Genesis</span></Link>
    </nav>
    <div className="portal-sidebar-tags"><h2><Tag size={15} />标签</h2>{tags.map((tag, index) => <button type="button" key={tag.id} aria-label={`筛选标签 ${tag.name}`} aria-pressed={activeTag === tag.slug} onClick={() => { onTag(tag.slug); onNavigate?.() }}><span className={`portal-tag-dot portal-tag-dot--${index % 4}`} aria-hidden="true" /><span>{tag.name}</span><small>{tag.post_count}</small></button>)}{error && <button className="portal-tags-retry" type="button" onClick={onRetry}>重新加载标签</button>}</div>
  </>
}

function MobileNavigation({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(close)
  return <dialog ref={dialog} className="portal-mobile-navigation" aria-label="博客导航菜单" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}><div className="portal-mobile-navigation-surface"><header><span>Genesis Journal</span><button ref={close} type="button" aria-label="关闭博客导航" onClick={onClose}><X size={20} /></button></header>{children}</div></dialog>
}

export function BlogDirectory() {
  const [params, setParams] = useSearchParams()
  const query = (params.get('q') ?? '').trim().slice(0, 200)
  const activeTag = params.get('tag') ?? ''
  const page = Math.min(1000000, Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1))
  const requestKey = JSON.stringify([query, activeTag, page])
  const returnTo = `/blog${params.size ? `?${params}` : ''}`
  const [state, setState] = useState<DirectoryState>({ key: requestKey, status: 'loading', items: [], total: 0 })
  const [topics, setTopics] = useState<PublicBlogTag[]>([])
  const [tagsError, setTagsError] = useState(false)
  const [tagsRetry, setTagsRetry] = useState(0)
  const [retry, setRetry] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 800px)').matches ?? false)
  const [featuredIndex, setFeaturedIndex] = useState(0)
  const heading = useRef<HTMLHeadingElement>(null)
  const current: DirectoryState = state.key === requestKey ? state : { key: requestKey, status: 'loading', items: [], total: 0 }
  const featured = !query && !activeTag && page === 1 ? current.items.filter(post => post.is_featured) : []
  const feature = featured[Math.min(featuredIndex, Math.max(0, featured.length - 1))]
  const pages = Math.max(1, Math.ceil(current.total / pageSize))
  const filtered = Boolean(query || activeTag)

  useEffect(() => {
    document.title = '博客 · Genesis'
    if (!window.matchMedia) return
    const media = window.matchMedia('(max-width: 800px)')
    function update() { setMobile(media.matches); if (!media.matches) setMobileOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || !(target instanceof HTMLElement) || target.isContentEditable || target.closest('input, textarea, select, dialog')) return
      event.preventDefault(); setSearchOpen(true)
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setState({ key: requestKey, status: 'loading', items: [], total: 0 })
      void getBlogPosts(controller.signal, undefined, { q: query, tag: activeTag, offset: page > 1 ? (page - 1) * pageSize : undefined }).then(data => {
        if (controller.signal.aborted) return
        const last = Math.max(1, Math.ceil(data.total / pageSize))
        if (page > last) { setParams(previous => { const next = new URLSearchParams(previous); if (last === 1) next.delete('page'); else next.set('page', String(last)); return next }, { replace: true }); return }
        setState({ key: requestKey, status: 'ready', items: data.items, total: data.total })
      }).catch(() => { if (!controller.signal.aborted) setState({ key: requestKey, status: 'error', items: [], total: 0 }) })
    }, 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, activeTag, page, requestKey, retry, setParams])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setTagsError(false)
      void getPublicBlogTags(controller.signal).then(data => {
        if (!Array.isArray(data)) throw new Error('标签数据格式不正确')
        if (!controller.signal.aborted) setTopics(data)
      }).catch(() => { if (!controller.signal.aborted) setTagsError(true) })
    }, 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [tagsRetry])

  function filter(tag: string) {
    const next = new URLSearchParams(params)
    if (tag) next.set('tag', tag); else next.delete('tag')
    next.delete('page'); setParams(next)
  }

  function search(value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set('q', value); else next.delete('q')
    next.delete('page'); setParams(next); setSearchOpen(false)
  }

  function changePage(value: number) {
    const next = new URLSearchParams(params)
    if (value === 1) next.delete('page'); else next.set('page', String(value))
    setParams(next); heading.current?.scrollIntoView({ block: 'start' })
  }

  const navigation = (onNavigate?: () => void) => <Navigation tags={topics} activeTag={activeTag} error={tagsError} onTag={filter} onRetry={() => setTagsRetry(value => value + 1)} onNavigate={onNavigate} />

  return <div className={`blog-portal${collapsed ? ' blog-portal--collapsed' : ''}`} id="top">
    <header className="portal-header">
      <div className="portal-brand"><button type="button" aria-label={mobile ? '打开博客导航' : collapsed ? '展开博客侧栏' : '收起博客侧栏'} aria-expanded={mobile ? mobileOpen : !collapsed} onClick={() => { if (mobile) setMobileOpen(true); else setCollapsed(value => !value) }}><Menu size={21} /></button><Link to="/blog">Genesis Journal</Link></div>
      <button className="portal-search-trigger" type="button" onClick={() => setSearchOpen(true)} aria-label="搜索文章"><Search size={19} /><span>{query || '搜索文章'}</span><kbd>/</kbd></button>
      <Link className="portal-account" to="/account" aria-label="打开账户"><UserRound size={23} /></Link>
    </header>
    <aside className="portal-sidebar" aria-label="博客侧栏">{navigation()}</aside>
    <main className="portal-main">
      <h1 className="sr-only">Genesis 博客</h1>
      <nav className="portal-topics" aria-label="按标签筛选文章"><button type="button" className={!activeTag ? 'is-active' : ''} aria-pressed={!activeTag} onClick={() => filter('')}>全部文章</button>{topics.map(tag => <button key={tag.id} type="button" className={activeTag === tag.slug ? 'is-active' : ''} aria-pressed={activeTag === tag.slug} onClick={() => filter(tag.slug)}>{tag.name}</button>)}</nav>
      {feature && <section className="portal-featured" aria-label="精选文章">
        <div className="portal-featured-copy"><Author post={feature} /><div className="portal-featured-topics">{feature.tags.map(tag => tag.name).join(' · ') || feature.category?.name || '精选文章'}</div><h2>{feature.title}</h2>{feature.excerpt && <p>{feature.excerpt}</p>}<div className="portal-featured-actions"><Link to={`/articles/${encodeURIComponent(feature.slug)}`} state={{ blogReturnTo: returnTo }} aria-label={`阅读全文 ${feature.title}`}>阅读全文 <ArrowRight size={19} /></Link>{featured.length > 1 && <div className="portal-featured-pages"><button type="button" aria-label="精选文章：上一篇" disabled={featuredIndex === 0} onClick={() => setFeaturedIndex(value => Math.max(0, value - 1))}><ArrowLeft size={20} /></button><button type="button" aria-label="精选文章：下一篇" disabled={featuredIndex >= featured.length - 1} onClick={() => setFeaturedIndex(value => Math.min(featured.length - 1, value + 1))}><ArrowRight size={20} /></button></div>}</div></div>
        <div className="portal-featured-cover"><Cover key={feature.id} post={feature} featured /><div className="portal-cover-meta"><time dateTime={feature.published_at}>{dateFormatter.format(new Date(feature.published_at))}</time><span>{feature.read_time_minutes} 分钟阅读</span></div></div>
      </section>}
      <section className="portal-posts" id="articles" aria-labelledby="articles-title" aria-busy={current.status === 'loading'}>
        <div className="portal-section-heading"><h2 id="articles-title" ref={heading}>{query ? `搜索「${query}」` : '最近的文章'}</h2>{current.status === 'ready' && <span>{current.total} 篇记录</span>}</div>
        {filtered && <div className="portal-filter-summary"><span>{activeTag && `标签：${topics.find(tag => tag.slug === activeTag)?.name ?? activeTag}`}</span><button type="button" onClick={() => setParams(new URLSearchParams())}>清除筛选 <X size={14} /></button></div>}
        {current.status === 'loading' ? <div className="portal-feedback" role="status">正在加载文章…</div> : current.status === 'error' ? <div className="portal-feedback" role="alert"><h3>文章暂时未能加载</h3><p>内容服务暂时不可用，请重新加载。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : current.items.length === 0 ? <div className="portal-feedback"><h3>{filtered ? '没有匹配的文章' : '还没有发布的文章'}</h3><p>{filtered ? '试试其他关键词或标签。' : '之后再来看看新的记录。'}</p>{filtered && <button type="button" onClick={() => setParams(new URLSearchParams())}>查看全部文章</button>}</div> : <ul className="portal-post-grid" aria-label="文章列表">{current.items.map(post => <li key={post.id}><article><Link className="portal-post-link" to={`/articles/${encodeURIComponent(post.slug)}`} state={{ blogReturnTo: returnTo }} aria-label={`阅读 ${post.title}`}><div className="portal-post-cover"><Cover key={post.cover_image_url ?? post.id} post={post} />{(post.category || post.tags[0]) && <span className="portal-post-topic">{post.category?.name ?? post.tags[0]?.name}</span>}</div><h3>{post.title}</h3>{post.excerpt && <p>{post.excerpt}</p>}<div className="portal-post-tags">{post.tags.slice(0, 2).map(tag => <span key={tag.id}>#{tag.name}</span>)}</div><footer><Author post={post} /><time dateTime={post.published_at}>{dateFormatter.format(new Date(post.published_at))}</time></footer></Link></article></li>)}</ul>}
        {current.status === 'ready' && pages > 1 && <nav className="portal-pagination" aria-label="文章分页"><button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}><ChevronLeft size={16} />上一页</button><span>第 {page} / {pages} 页</span><button type="button" disabled={page >= pages} onClick={() => changePage(page + 1)}>下一页<ChevronRight size={16} /></button></nav>}
      </section>
      <BlogLinks />
      <footer className="portal-footer"><span>Genesis · 记录与分享</span><a href="#top">回到顶部 ↑</a></footer>
    </main>
    {searchOpen && <BlogSearch initialQuery={query} onClose={() => setSearchOpen(false)} onSearch={search} />}
    {mobileOpen && <MobileNavigation onClose={() => setMobileOpen(false)}>{navigation(() => setMobileOpen(false))}</MobileNavigation>}
  </div>
}
