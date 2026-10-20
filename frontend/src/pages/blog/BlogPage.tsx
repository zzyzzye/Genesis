import './BlogPage.css'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArticleDocument } from '../../features/blog/ArticleToc'
import { BlogLinks } from '../../features/blog/BlogLinks'
import { ArticleComments } from '../../features/blog/ArticleComments'
import { ArticleGuide } from '../../features/blog/ArticleGuide'

import { getBlogPost, getBlogPosts, type BlogPostDetail, type BlogPostPreview, type BlogTag } from '../../lib/api'

type BlogState =
  | { status: 'loading' }
  | { status: 'ready'; posts: BlogPostPreview[]; total: number }
  | { status: 'error' }

type ArticleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; post: BlogPostDetail }
  | { status: 'error' }

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
const emptyPosts: BlogPostPreview[] = []

function formatDate(value: string): string { return dateFormatter.format(new Date(value)) }

function getTags(posts: BlogPostPreview[]): BlogTag[] {
  const tags = new Map<string, BlogTag>()
  for (const post of posts) for (const tag of post.tags) tags.set(tag.slug, tag)
  return [...tags.values()]
}

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
  const [blogState, setBlogState] = useState<BlogState>({ status: 'loading' })
  const [articleState, setArticleState] = useState<ArticleState>({ status: 'idle' })
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const articleRequest = useRef<AbortController | null>(null)
  const isArticle = location.pathname.startsWith('/articles/')
  const currentArticle = articleState.status === 'ready' && articleState.post.slug === slug ? articleState.post : null

  useEffect(() => {
    document.title = articleState.status === 'ready' ? `${articleState.post.title} · Genesis` : '博客 · Genesis'
  }, [articleState])

  useEffect(() => {
    const controller = new AbortController()

    void getBlogPosts(controller.signal)
      .then((data) => setBlogState({ status: 'ready', posts: data.items, total: data.total }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setBlogState({ status: 'error' })
        }
      })

    return () => controller.abort()
  }, [refreshKey])

  useEffect(
    () => () => {
      articleRequest.current?.abort()
    },
    [],
  )

  const posts = blogState.status === 'ready' ? blogState.posts : emptyPosts
  const tags = useMemo(() => getTags(posts), [posts])
  const visiblePosts = useMemo(
    () =>
      activeTag === null ? posts : posts.filter((post) => post.tags.some((tag) => tag.slug === activeTag)),
    [activeTag, posts],
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
    void navigate('/blog')
  }

  function retryPosts() {
    setBlogState({ status: 'loading' })
    setRefreshKey((key) => key + 1)
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

  return (
    <div className={`blog-page${isArticle ? ' blog-page--article' : ' blog-page--index'}`} id="top">
      <header className="blog-masthead">
        <Link className="blog-home-link" to="/" aria-label="返回 Genesis 首页">
          <span aria-hidden="true">←</span> Genesis
        </Link>
        <Link className="blog-wordmark" to="/blog" onClick={closeArticle}>Genesis Journal</Link>
        <div className="blog-masthead-links"><Link className="blog-account-link" to="/blog/pages">页面</Link><Link className="blog-account-link" to="/account" aria-label="打开账户">账户 <span aria-hidden="true">↗</span></Link></div>
      </header>

      <main>
        {isArticle ? (
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
        ) : (
          <div className="blog-index-layout">
            <aside className="blog-index-sidebar" aria-label="博客介绍与主题">
              <header className="blog-index-intro">
                <h1>博客<span aria-hidden="true">.</span></h1>
                <p>记录技术实践、产品思考<br className="blog-index-intro-break" />与日常随笔。</p>
              </header>
              {blogState.status === 'ready' && <nav className="blog-topics" aria-label="按标签筛选文章">
                <h2>阅读主题</h2>
                <div className="tag-filter">
                  <button
                    className={activeTag === null ? 'is-active' : ''}
                    type="button"
                    aria-pressed={activeTag === null}
                    onClick={() => setActiveTag(null)}
                  >
                    <span>全部</span><span className="blog-topic-count" aria-hidden="true">{posts.length}</span>
                  </button>
                  {tags.map((tag) => (
                    <button
                      className={activeTag === tag.slug ? 'is-active' : ''}
                      key={tag.id}
                      type="button"
                      aria-pressed={activeTag === tag.slug}
                      onClick={() => setActiveTag(tag.slug)}
                    >
                      <span>{tag.name}</span><span className="blog-topic-count" aria-hidden="true">{posts.filter(post => post.tags.some(item => item.slug === tag.slug)).length}</span>
                    </button>
                  ))}
                </div>
              </nav>}
            </aside>

            <section className="blog-index" id="articles" aria-labelledby="articles-title" aria-busy={blogState.status === 'loading'}>
              <div className="blog-index-heading">
                <h2 id="articles-title">最近的文章</h2>
                {blogState.status === 'ready' && <span aria-live="polite">{activeTag ? `${visiblePosts.length} 篇匹配` : `${blogState.total} 篇记录`}</span>}
              </div>

              {blogState.status === 'loading' && (
                <div className="blog-index-feedback" role="status">正在加载文章…</div>
              )}

              {blogState.status === 'error' && (
                <div className="blog-index-feedback" role="alert">
                  <h3>文章暂时未能加载</h3>
                  <p>内容服务暂时不可用，请重新加载。</p>
                  <button type="button" onClick={retryPosts}>
                    重新加载
                  </button>
                </div>
              )}

              {blogState.status === 'ready' && (
                <>
                  {visiblePosts.length > 0 && (
                    <ul className="blog-article-list" aria-label="文章列表">
                      {visiblePosts.map((post) => (
                        <li key={post.id}>
                          <Link
                            className="blog-article-link"
                            to={`/articles/${encodeURIComponent(post.slug)}`}
                            aria-label={`阅读 ${post.title}`}
                          >
                            <div className="blog-article-copy">
                              <div className="blog-article-meta">
                                <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
                                <span>{post.read_time_minutes} 分钟阅读</span>
                                <TagList tags={post.tags} />
                              </div>
                              <div className="blog-article-title"><h3>{post.title}{post.is_featured && <span className="blog-article-featured">精选</span>}</h3><span className="blog-article-arrow" aria-hidden="true">↗</span></div>
                              {post.excerpt && <p>{post.excerpt}</p>}
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  {visiblePosts.length === 0 && <div className="blog-index-feedback"><h3>{activeTag ? '这个标签下还没有公开文章' : '还没有发布的文章'}</h3><p>{activeTag ? '切换到全部文章，看看其他记录。' : '之后再来看看新的记录。'}</p>{activeTag && <button type="button" onClick={() => setActiveTag(null)}>查看全部文章</button>}</div>}
                </>
              )}
            </section>
          </div>
        )}
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
