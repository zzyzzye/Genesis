import './BlogPage.css'

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArticleDocument } from '../../features/blog/ArticleToc'
import { BlogLinks } from '../../features/blog/BlogLinks'
import { ArticleComments } from '../../features/blog/ArticleComments'
import { ArticleGuide } from '../../features/blog/ArticleGuide'
import { BlogDirectory } from '../../features/blog/BlogDirectory'

import { getBlogPost, type BlogPostDetail, type BlogTag } from '../../lib/api'

type ArticleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; post: BlogPostDetail }
  | { status: 'error' }

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })

function formatDate(value: string): string { return dateFormatter.format(new Date(value)) }

function MarkdownContent({ content }: { content: string }) {
  return <ArticleDocument content={content} />
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
  const location = useLocation()
  const { slug } = useParams<{ slug: string }>()
  const [articleState, setArticleState] = useState<ArticleState>({ status: 'idle' })
  const articleRequest = useRef<AbortController | null>(null)
  const isArticle = location.pathname.startsWith('/articles/')
  const currentArticle = articleState.status === 'ready' && articleState.post.slug === slug ? articleState.post : null

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
    <div className="blog-page blog-page--article" id="top">
      <header className="blog-masthead">
        <Link className="blog-home-link" to="/" aria-label="返回 Genesis 首页">
          <span aria-hidden="true">←</span> Genesis
        </Link>
        <Link className="blog-wordmark" to="/blog">Genesis Journal</Link>
        <div className="blog-masthead-links"><Link className="blog-account-link" to="/blog/pages">页面</Link><Link className="blog-account-link" to="/account" aria-label="打开账户">账户 <span aria-hidden="true">↗</span></Link></div>
      </header>

      <main>
        <article className="reader-shell">
          <button className="back-button" type="button" onClick={closeArticle}>
            <span aria-hidden="true">←</span> 返回文章列表
          </button>
          {currentArticle ? (
            <>
              <header className="reader-intro">
                <TagList tags={currentArticle.tags} />
                <ArticleTitle title={currentArticle.title} />
                {currentArticle.excerpt && <p className="reader-summary">{currentArticle.excerpt}</p>}
                <div className="article-meta">
                  <span>{currentArticle.author.display_name}</span>
                  <time dateTime={currentArticle.published_at}>{formatDate(currentArticle.published_at)}</time>
                  <span>{currentArticle.read_time_minutes} 分钟阅读</span>
                </div>
              </header>
              <ArticleGuide key={`${currentArticle.id}:${currentArticle.content_revision ?? ''}`} slug={currentArticle.slug} revision={currentArticle.content_revision} />
              <MarkdownContent content={currentArticle.content_markdown} />
              <ArticleComments key={currentArticle.slug} slug={currentArticle.slug} />
            </>
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
        <span>Genesis Journal</span>
        <a href="#top">回到顶部 ↑</a>
      </footer>
    </div>
  )
}


export { PublicBlog }
