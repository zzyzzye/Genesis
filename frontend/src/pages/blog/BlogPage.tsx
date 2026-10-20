import './BlogPage.css'
import './BlogReader.css'

import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useLocation, useNavigate, useParams, type Location } from 'react-router-dom'
import { ArrowUp, Search, UserRound } from 'lucide-react'
import { ArticleDocument } from '../../features/blog/ArticleToc'
import { BlogLinks } from '../../features/blog/BlogLinks'
import { ArticleComments } from '../../features/blog/ArticleComments'
import { ArticleGuide } from '../../features/blog/ArticleGuide'
import { GenesisLogo } from '../../components/GenesisLogo'
import { BlogDirectory } from '../../features/blog/BlogDirectory'
import { BlogSearch } from '../../features/blog/BlogSearch'
import { FpsStatusSlot } from '../../features/performance/FpsMonitor'

import { getBlogPost, type BlogAuthor, type BlogPostDetail, type BlogTag } from '../../lib/api'

type ArticleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; post: BlogPostDetail }
  | { status: 'error' }

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

function formatDate(value: string): string { return dateFormatter.format(new Date(value)) }

function ReaderAuthor({ author }: { author: BlogAuthor }) {
  const [failed, setFailed] = useState(false)
  return <section className="reader-author" aria-label="本文作者">
    <span className="reader-author__label">本文作者</span>
    {author.avatar_url && !failed ? <img src={author.avatar_url} alt="" width={40} height={40} onError={() => setFailed(true)} /> : <span className="reader-author__avatar" aria-hidden="true">{author.display_name.slice(0, 1).toUpperCase()}</span>}
    <div><strong>{author.display_name}</strong><span className="reader-author__handle">@{author.handle}</span></div>
  </section>
}

function TagList({ tags }: { tags: BlogTag[] }) {
  if (tags.length === 0) return null
  return <div className="tag-list" aria-label="文章标签">{tags.map((tag) => <span className="tag" key={tag.id}>{tag.name}</span>)}</div>
}

function ArticleTitle({ title }: { title: string }) {
  // 长标题优先按冒号分成主题与说明，避免窄屏留下孤立的尾字。
  const parts = title.length > 28 ? /^(.{8,32}?[：:])\s*(.+)$/u.exec(title) : null
  return <h1>{parts ? <><span>{parts[1]}</span><span>{parts[2]}</span></> : title}</h1>
}

function PublicBlog() {
  const navigate = useNavigate()
  const location: Location<unknown> = useLocation()
  const { slug } = useParams<{ slug: string }>()
  const [articleState, setArticleState] = useState<ArticleState>({ status: 'idle' })
  const [searchOpen, setSearchOpen] = useState(false)
  const articleRequest = useRef<AbortController | null>(null)
  const isArticle = location.pathname.startsWith('/articles/')
  const currentArticle = articleState.status === 'ready' && articleState.post.slug === slug ? articleState.post : null

  useEffect(() => {
    if (!isArticle) return
    function shortcut(event: KeyboardEvent) {
      const target = event.target
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || !(target instanceof HTMLElement) || target.isContentEditable || target.closest('input, textarea, select, dialog')) return
      event.preventDefault()
      setSearchOpen(true)
    }
    document.addEventListener('keydown', shortcut)
    return () => document.removeEventListener('keydown', shortcut)
  }, [isArticle])

  useEffect(() => {
    document.title = articleState.status === 'ready' ? `${articleState.post.title} · Genesis` : '博客 · Genesis'
  }, [articleState])

  useEffect(
    () => () => {
      articleRequest.current?.abort()
    },
    [],
  )

  function openArticle(slug: string) {
    if (location.pathname !== `/articles/${slug}`) void navigate(`/articles/${slug}`)
    articleRequest.current?.abort()
    const controller = new AbortController()
    articleRequest.current = controller
    setArticleState({ status: 'loading' })

    void getBlogPost(slug, controller.signal)
      .then((post) => {
        if (!controller.signal.aborted) {
          setArticleState({ status: 'ready', post })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setArticleState({ status: 'error' })
        }
      })
  }

  function closeArticle() {
    articleRequest.current?.abort()
    const returnTo = (location.state as { blogReturnTo?: unknown } | null)?.blogReturnTo
    void navigate(typeof returnTo === 'string' && /^\/blog(?:\?|$)/.test(returnTo) ? returnTo : '/blog')
  }

  function returnToTop(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) requestAnimationFrame(() => document.getElementById('top')?.scrollIntoView({ block: 'start' }))
  }

  useEffect(() => {
    if (location.pathname.startsWith('/articles/') && slug !== undefined && (articleState.status === 'idle' || (articleState.status === 'ready' && articleState.post.slug !== slug))) {
      queueMicrotask(() => openArticle(slug))
    } else if (!location.pathname.startsWith('/articles/') && articleState.status !== 'idle') {
      queueMicrotask(() => setArticleState({ status: 'idle' }))
    }
    // URL 参数变化时同步打开对应文章。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, slug])

  if (!isArticle) return <BlogDirectory />

  return (
    <div className="blog-page blog-page--article blog-portal" id="top">
      <header className="portal-header reader-header">
        <div className="portal-brand"><Link className="reader-brand" to="/blog" aria-label="返回博客首页"><GenesisLogo label="Genesis Journal" /></Link></div>
        <button className="portal-search-trigger" type="button" onClick={() => setSearchOpen(true)} aria-label="搜索文章"><Search size={19} aria-hidden="true" /><span>搜索文章</span><kbd>/</kbd></button>
        <div className="fps-status-actions"><FpsStatusSlot /><Link className="portal-account" to="/account" aria-label="打开账户"><UserRound size={23} aria-hidden="true" /></Link></div>
      </header>

      <main>
        <article className="reader-shell">
          <button className="back-button" type="button" onClick={closeArticle}>
            <span aria-hidden="true">←</span> 返回文章列表
          </button>
          {currentArticle ? (
            <ArticleDocument
              content={currentArticle.content_markdown}
              className="reader-document"
              tocTitle="本文目录"
              sidebar={<ReaderAuthor key={`${currentArticle.author.id}:${currentArticle.author.avatar_url ?? ''}`} author={currentArticle.author} />}
              intro={<><header className="reader-intro">
                <TagList tags={currentArticle.tags} />
                <ArticleTitle title={currentArticle.title} />
                {currentArticle.excerpt && <p className="reader-summary">{currentArticle.excerpt}</p>}
                <div className="article-meta">
                  <span>{currentArticle.author.display_name}</span>
                  <time dateTime={currentArticle.published_at}>{formatDate(currentArticle.published_at)}</time>
                  <span>{currentArticle.read_time_minutes} 分钟阅读</span>
                </div>
              </header><ArticleGuide key={`${currentArticle.id}:${currentArticle.content_revision ?? ''}`} slug={currentArticle.slug} revision={currentArticle.content_revision} /></>}
            >
              <ArticleComments key={currentArticle.slug} slug={currentArticle.slug} />
            </ArticleDocument>
          ) : (
            <div className="reader-feedback" aria-busy={articleState.status !== 'error'}>
              {articleState.status === 'error' ? <>
                <h1>文章暂时无法打开</h1>
                <p role="alert">文章可能尚未公开，或内容服务暂时不可用。</p>
                <button type="button" onClick={() => { if (slug) openArticle(slug) }}>重新加载文章</button>
              </> : <p role="status">正在打开文章…</p>}
            </div>
          )}
        </article>
        <BlogLinks />
      </main>

      <footer className="blog-footer">
        <span>Genesis · 记录与分享</span>
        <Link to="#top" state={location.state} preventScrollReset onClick={returnToTop}>回到顶部 ↑</Link>
      </footer>
      <Link className="reader-back-top" to="#top" state={location.state} preventScrollReset onClick={returnToTop} aria-label="回到顶部"><ArrowUp size={20} aria-hidden="true" /></Link>
      {searchOpen && <BlogSearch initialQuery="" onClose={() => setSearchOpen(false)} onSearch={query => { setSearchOpen(false); void navigate(`/blog?${new URLSearchParams({ q: query })}`) }} />}
    </div>
  )
}


export { PublicBlog }
