import './BlogDirectory.css'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronLeft, ChevronRight, CornerUpLeft, Menu, PanelLeftClose, PanelLeftOpen, Search, Tag, UserRound, X } from 'lucide-react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { getBlogPosts, getPublicBlogTags, type BlogPostPreview, type PublicBlogTag } from '../../lib/api'
import { useModalDialog } from '../../studio/useModalDialog'
import { BlogLinks } from './BlogLinks'
import { BlogSearch } from './BlogSearch'
import { BlogHero } from './BlogHero'
import { GenesisLogo } from '../../components/GenesisLogo'
import { SpaceLinks } from '../../components/SpaceLinks'
import { FpsStatusSlot } from '../performance/FpsMonitor'
import { motionTiming, useLiveReducedMotion } from '../../lib/motion'

type DirectoryState = { key: string; status: 'loading' | 'ready' | 'error'; items: BlogPostPreview[]; total: number }
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
const pageSize = 12

function fallbackCover(post: BlogPostPreview): string {
  const topic = `${post.slug} ${post.title} ${post.tags.map(tag => tag.name).join(' ')}`.toLowerCase()
  if (/写作|文字|排版|markdown|writing/.test(topic)) return '/images/blog/writing.jpg'
  if (/python|linux|mcp|大模型|工程|技术|模块|code|module/.test(topic)) return '/images/blog/architecture.jpg'
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

function JournalBrand({ onNavigate }: { onNavigate?: () => void }) {
  return <Link className="portal-journal-brand" to="/blog#top" aria-label="Genesis Journal" title="Genesis Journal" onClick={onNavigate}>
    <GenesisLogo markOnly />
    <span className="portal-journal-wordmark"><strong>Genesis</strong><span>JOURNAL</span></span>
  </Link>
}

function Navigation({ tags, activeTag, error, onTag, onRetry, onNavigate }: { tags: PublicBlogTag[]; activeTag: string; error: boolean; onTag: (slug: string) => void; onRetry: () => void; onNavigate?: () => void }) {
  const [tagsOpen, setTagsOpen] = useState(false)
  return <>
    <nav className="portal-navigation" aria-label="博客导航">
      <span className="portal-nav-label">阅读</span>
      <Link to="/blog#top" className="is-active" aria-current="page" aria-label="博客首页" title="博客首页" onClick={onNavigate}><BookOpen size={18} /><span>博客首页</span><span className="portal-nav-current" aria-hidden="true" /></Link>
    </nav>
    <div className="portal-sidebar-tags">
      <button className="portal-tags-toggle" type="button" aria-expanded={tagsOpen} aria-label={tagsOpen ? '收起标签列表' : '展开标签列表'} onClick={() => setTagsOpen(value => !value)}><Tag size={17} /><span>探索标签</span><ChevronDown size={15} /></button>
      {tagsOpen && <ul className="portal-tag-list" aria-label="全部标签">{tags.map(tag => <li key={tag.id}><button type="button" aria-label={`筛选标签 ${tag.name}`} aria-pressed={activeTag === tag.slug} onClick={() => { onTag(tag.slug); onNavigate?.() }}><span>{tag.name}</span><span>{tag.post_count}</span></button></li>)}</ul>}
      {error && <button className="portal-tags-retry" type="button" onClick={onRetry}>重新加载标签</button>}
    </div>
    <nav className="portal-navigation portal-space-navigation" aria-label="其他空间">
      <span className="portal-nav-label">其他空间</span>
      <SpaceLinks current="blog" onNavigate={onNavigate} />
    </nav>
    <nav className="portal-navigation portal-account-navigation" aria-label="账户与返回">
      <Link to="/account" aria-label="我的账户" title="我的账户" onClick={onNavigate}><UserRound size={19} /><span>我的账户</span></Link>
      <Link to="/" aria-label="返回 Genesis" title="返回 Genesis" onClick={onNavigate}><CornerUpLeft size={19} /><span>返回 Genesis</span></Link>
    </nav>
  </>
}

function MobileNavigation({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(close)
  const reducedMotion = useLiveReducedMotion()
  return <motion.dialog ref={dialog} className="portal-mobile-navigation" aria-label="博客导航菜单" initial={reducedMotion ? false : { opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: reducedMotion ? 0 : motionTiming.blogSidebar, ease: motionTiming.ease }} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}><div className="portal-mobile-navigation-surface"><header><JournalBrand onNavigate={onClose} /><button ref={close} type="button" aria-label="关闭博客导航" onClick={onClose}><X size={20} /></button></header>{children}</div></motion.dialog>
}

export function BlogDirectory() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const query = (params.get('q') ?? '').trim().slice(0, 200)
  const activeTag = params.get('tag') ?? ''
  const page = Math.min(1000000, Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1))
  const requestKey = JSON.stringify([query, activeTag, page])
  const returnTo = `/blog${params.size ? `?${params}` : ''}#articles`
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
  const readingArea = useRef<HTMLDivElement>(null)
  const previousRequest = useRef(requestKey)
  const current: DirectoryState = state.key === requestKey ? state : { key: requestKey, status: 'loading', items: [], total: 0 }
  const featured = !query && !activeTag && page === 1 ? current.items.filter(post => post.is_featured) : []
  const feature = featured[Math.min(featuredIndex, Math.max(0, featured.length - 1))]
  const pages = Math.max(1, Math.ceil(current.total / pageSize))
  const filtered = Boolean(query || activeTag)

  useLayoutEffect(() => {
    const changed = previousRequest.current !== requestKey
    previousRequest.current = requestKey
    // 筛选、分页及从文章返回时直接进入阅读区，不要求再次划过封面。
    if (filtered || page > 1 || location.hash === '#articles' || (changed && location.hash !== '#top')) {
      const readFromHero = location.hash === '#articles' && (location.state as { smoothBlogScroll?: boolean } | null)?.smoothBlogScroll === true
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (readFromHero) document.getElementById('articles')?.focus({ preventScroll: true })
      readingArea.current?.scrollIntoView({ block: 'start', behavior: readFromHero && !reducedMotion ? 'smooth' : 'instant' })
    } else if (location.hash === '#top') {
      document.getElementById('top')?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }, [requestKey, filtered, page, location.hash, location.key, location.state])

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

  return <div className={`blog-portal${collapsed ? ' blog-portal--collapsed' : ''}`} id="top" style={{ '--portal-motion-duration': `${motionTiming.blogSidebar}s`, '--portal-motion-ease': `cubic-bezier(${motionTiming.ease.join(',')})` } as CSSProperties}>
    <BlogHero />
    <div className="portal-reading-layout" ref={readingArea}>
    <header className="portal-directory-header">
      <div className="portal-header-location">
        <button className="portal-sidebar-toggle" type="button" aria-label={mobile ? '打开博客导航' : collapsed ? '展开博客侧栏' : '收起博客侧栏'} title={mobile ? '打开导航' : collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={mobile ? mobileOpen : !collapsed} onClick={() => { if (mobile) setMobileOpen(true); else setCollapsed(value => !value) }}>{mobile ? <Menu size={20} /> : collapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
        <nav className="portal-breadcrumb" aria-label="当前位置"><Link to="/blog#top">博客</Link><ChevronRight size={13} aria-hidden="true" /><span aria-current="page">{query ? '搜索结果' : activeTag ? '标签筛选' : '文章'}</span></nav>
        <div className="portal-mobile-brand"><JournalBrand /></div>
      </div>
      <div className="portal-header-actions">
        <button className="portal-directory-search" type="button" onClick={() => setSearchOpen(true)} aria-label="搜索文章"><Search size={17} /><span>{query || '搜索文章…'}</span><kbd>/</kbd></button>
        <FpsStatusSlot />
        <Link className="portal-directory-account" to="/account" aria-label="打开账户" title="打开账户"><UserRound size={19} /></Link>
      </div>
    </header>
    <aside className="portal-sidebar" aria-label="博客侧栏"><JournalBrand />{navigation()}</aside>
    <main className="portal-main">
      {feature && <section key={feature.id} className="portal-featured" aria-label="精选文章">
        <div className="portal-featured-copy"><Author post={feature} /><div className="portal-featured-topics">{feature.tags.map(tag => tag.name).join(' · ') || (feature.categories ?? (feature.category ? [feature.category] : [])).map(category => category.name).join(' · ') || '精选文章'}</div><h2>{feature.title}</h2>{feature.excerpt && <p>{feature.excerpt}</p>}<div className="portal-featured-actions"><Link to={`/articles/${encodeURIComponent(feature.slug)}`} state={{ blogReturnTo: returnTo }} aria-label={`阅读全文 ${feature.title}`}>阅读全文 <ArrowRight size={19} /></Link>{featured.length > 1 && <div className="portal-featured-pages"><button type="button" aria-label="精选文章：上一篇" disabled={featuredIndex === 0} onClick={() => setFeaturedIndex(value => Math.max(0, value - 1))}><ArrowLeft size={20} /></button><button type="button" aria-label="精选文章：下一篇" disabled={featuredIndex >= featured.length - 1} onClick={() => setFeaturedIndex(value => Math.min(featured.length - 1, value + 1))}><ArrowRight size={20} /></button></div>}</div></div>
        <div className="portal-featured-cover"><Cover key={feature.id} post={feature} featured /><div className="portal-cover-meta"><time dateTime={feature.published_at}>{dateFormatter.format(new Date(feature.published_at))}</time><span>{feature.read_time_minutes} 分钟阅读</span></div></div>
      </section>}
      <section className="portal-posts" id="articles" tabIndex={-1} aria-labelledby="articles-title" aria-busy={current.status === 'loading'}>
        <div className="portal-section-heading"><h1 id="articles-title" ref={heading}>{query ? `搜索「${query}」` : '最近的文章'}</h1>{current.status === 'ready' && <span>{current.total} 篇文章</span>}</div>
        <nav className="portal-topics" aria-label="按标签筛选文章"><button type="button" aria-pressed={!activeTag} onClick={() => filter('')}>全部文章</button>{topics.map(tag => <button key={tag.id} type="button" aria-pressed={activeTag === tag.slug} onClick={() => filter(tag.slug)}>{tag.name}</button>)}</nav>
        {filtered && <div className="portal-filter-summary"><span>{activeTag && `标签：${topics.find(tag => tag.slug === activeTag)?.name ?? activeTag}`}</span><button type="button" onClick={() => setParams(new URLSearchParams())}>清除筛选 <X size={14} /></button></div>}
        {current.status === 'loading' ? <div className="portal-feedback" role="status">正在加载文章…</div> : current.status === 'error' ? <div className="portal-feedback" role="alert"><h3>文章暂时未能加载</h3><p>内容服务暂时不可用，请重新加载。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新加载</button></div> : current.items.length === 0 ? <div className="portal-feedback"><h3>{filtered ? '没有匹配的文章' : '还没有发布的文章'}</h3><p>{filtered ? '试试其他关键词或标签。' : '之后再来看看新的记录。'}</p>{filtered && <button type="button" onClick={() => setParams(new URLSearchParams())}>查看全部文章</button>}</div> : (
          <ul className="portal-post-grid" aria-label="文章列表">
            {current.items.map(post => <li key={post.id}><article>
              <Link className="portal-post-link" to={`/articles/${encodeURIComponent(post.slug)}`} state={{ blogReturnTo: returnTo }} aria-label={`阅读 ${post.title}`}>
                <div className="portal-post-cover"><Cover key={post.cover_image_url ?? post.id} post={post} /></div>
                <div className="portal-post-topline"><span className="portal-post-tags">{post.tags.slice(0, 2).map(tag => <span key={tag.id} title={tag.name}>{tag.name}</span>)}</span><span>{post.read_time_minutes} 分钟阅读</span></div>
                <h2 title={post.title}>{post.title}</h2>
                {post.excerpt && <p>{post.excerpt}</p>}
                <footer><Author post={post} /><time dateTime={post.published_at}>{dateFormatter.format(new Date(post.published_at))}</time></footer>
              </Link>
            </article></li>)}
          </ul>
        )}
        {current.status === 'ready' && pages > 1 && <nav className="portal-pagination" aria-label="文章分页"><button type="button" disabled={page <= 1} onClick={() => changePage(page - 1)}><ChevronLeft size={16} />上一页</button><span>第 {page} / {pages} 页</span><button type="button" disabled={page >= pages} onClick={() => changePage(page + 1)}>下一页<ChevronRight size={16} /></button></nav>}
      </section>
      <BlogLinks />
      <footer className="portal-footer"><span>Genesis · 记录与分享</span><a href="#top">回到顶部 ↑</a></footer>
    </main>
    </div>
    {searchOpen && <BlogSearch initialQuery={query} onClose={() => setSearchOpen(false)} onSearch={search} />}
    {mobileOpen && <MobileNavigation onClose={() => setMobileOpen(false)}>{navigation(() => setMobileOpen(false))}</MobileNavigation>}
  </div>
}
