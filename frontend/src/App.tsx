import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import {
  getBlogPost,
  getBlogPosts,
  type BlogPostDetail,
  type BlogPostPreview,
  type BlogTag,
} from './lib/api'
import { Account } from './Account'
import { Studio } from './Studio'
import { SystemLanding } from './SystemLanding'

type BlogState =
  | { status: 'loading' }
  | { status: 'ready'; posts: BlogPostPreview[]; total: number }
  | { status: 'error' }

type ArticleState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; post: BlogPostDetail }
  | { status: 'error' }

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})
const emptyPosts: BlogPostPreview[] = []

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value))
}

function getTags(posts: BlogPostPreview[]): BlogTag[] {
  const tags = new Map<string, BlogTag>()
  for (const post of posts) {
    for (const tag of post.tags) {
      tags.set(tag.slug, tag)
    }
  }
  return [...tags.values()]
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="article-content">
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  )
}

function TagList({ tags }: { tags: BlogTag[] }) {
  return (
    <div className="tag-list" aria-label="文章标签">
      {tags.map((tag) => (
        <span className="tag" key={tag.id}>
          {tag.name}
        </span>
      ))}
    </div>
  )
}

function Home() {
  return (
    <div className="page" id="top">
      <header className="site-header">
        <Link className="brand" to="/">Genesis<span>.</span></Link>
        <nav aria-label="主导航">
          <Link to="/blog">博客</Link>
          <Link to="/account">账户</Link>
          <Link to="/blog/studio">博客 Studio</Link>
          <Link to="/tools">工具</Link>
          <Link to="/media">影音</Link>
        </nav>
        <span className="module-state">00 / Genesis</span>
      </header>
      <main>
        <section className="intro home-intro" aria-labelledby="home-title">
          <p className="eyebrow">PERSONAL OPERATING SYSTEM</p>
          <h1 id="home-title">把生活里重要的事，放进一个<em>会生长的系统。</em></h1>
          <p className="intro-copy">Genesis 是一个逐步生长的个人系统，从内容沉淀、日常工具到影音记录，把分散的思考和创造连接起来。</p>
        </section>
        <section className="home-systems" aria-labelledby="systems-title">
          <div className="section-heading">
            <div><p className="eyebrow">THREE SYSTEMS</p><h2 id="systems-title">从一个入口，进入三个世界</h2></div>
          </div>
          <div className="home-system-grid">
            <Link className="home-system-card home-system-card--blog" to="/blog"><span>01</span><h3>博客</h3><p>沉淀值得反复回看的想法、文章与长期记录。</p><strong>进入博客 ↗</strong></Link>
            <Link className="home-system-card home-system-card--tools" to="/tools"><span>02</span><h3>工具</h3><p>把重复的工作整理成可以直接使用的小工具。</p><strong>进入工具 ↗</strong></Link>
            <Link className="home-system-card home-system-card--media" to="/media"><span>03</span><h3>影音</h3><p>记录正在发生的现场、声音和影像。</p><strong>进入影音 ↗</strong></Link>
          </div>
        </section>
      </main>
      <footer className="site-footer"><span>Genesis · 个人内容系统</span><span>Build slowly. Keep growing.</span></footer>
    </div>
  )
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
  const featuredPost = visiblePosts.find((post) => post.is_featured) ?? visiblePosts[0]
  const regularPosts = visiblePosts.filter((post) => post.slug !== featuredPost?.slug)

  function openArticle(slug: string) {
    void navigate(`/articles/${slug}`)
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
    setArticleState({ status: 'idle' })
  }

  function retryPosts() {
    setBlogState({ status: 'loading' })
    setRefreshKey((key) => key + 1)
  }

  useEffect(() => {
    if (location.pathname.startsWith('/articles/') && slug !== undefined && articleState.status === 'idle') {
      queueMicrotask(() => openArticle(slug))
    }
    // URL 参数变化时同步打开对应文章。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, slug])

  return (
    <div className="page" id="top">
      <header className="site-header">
        <Link className="brand" to="/blog" onClick={closeArticle}>
          Genesis<span>.</span>
        </Link>
        <nav aria-label="主导航">
          <Link to="/blog" onClick={closeArticle}>
            博客
          </Link>
          <Link to="/account">账户</Link>
          <Link to="/blog/studio">博客 Studio</Link>
          <Link to="/tools">工具</Link>
          <Link to="/media">影音</Link>
        </nav>
        <span className="module-state">01 / Blog</span>
      </header>

      <main>
        {articleState.status === 'ready' ? (
          <article className="reader-shell">
            <button className="back-button" type="button" onClick={closeArticle}>
              <span aria-hidden="true">←</span> 返回文章列表
            </button>
            <div className="reader-intro">
              <TagList tags={articleState.post.tags} />
              <h1>{articleState.post.title}</h1>
              <p className="reader-summary">{articleState.post.excerpt}</p>
              <div className="article-meta">
                <span>{articleState.post.author.display_name}</span>
                <span>{formatDate(articleState.post.published_at)}</span>
                <span>{articleState.post.read_time_minutes} 分钟阅读</span>
              </div>
            </div>
            <MarkdownContent content={articleState.post.content_markdown} />

          </article>
        ) : (
          <>
            <section className="intro" aria-labelledby="page-title">
              <p className="eyebrow">PERSONAL KNOWLEDGE SPACE</p>
              <h1 id="page-title">
                把热爱、思考和<br />
                <em>长期主义</em>放在同一个空间。
              </h1>
              <p className="intro-copy">
                Genesis 是一个逐步生长的个人系统。现在从博客开始，沉淀值得反复回看的想法与创造。
              </p>
              <div className="progress-grid" aria-label="产品建设进度">
                <div>
                  <strong>01</strong>
                  <span>博客正在构建</span>
                </div>
                <div>
                  <strong>02</strong>
                  <span>工具随后接入</span>
                </div>
                <div>
                  <strong>03</strong>
                  <span>影音最后展开</span>
                </div>
              </div>
            </section>

            <section className="articles" id="articles" aria-labelledby="articles-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">WRITING</p>
                  <h2 id="articles-title">最近的文章</h2>
                </div>
                {blogState.status === 'ready' && <span>{blogState.total} 篇记录</span>}
              </div>

              {articleState.status === 'loading' && (
                <p className="inline-message" role="status">
                  正在打开文章…
                </p>
              )}
              {articleState.status === 'error' && (
                <p className="inline-message inline-message--error" role="alert">
                  文章暂时无法打开，请稍后再试。
                </p>
              )}

              {blogState.status === 'loading' && (
                <div className="loading-grid" aria-label="正在加载文章">
                  <div />
                  <div />
                  <div />
                </div>
              )}

              {blogState.status === 'error' && (
                <div className="error-state" role="alert">
                  <p>暂时无法连接到博客内容服务。</p>
                  <button type="button" onClick={retryPosts}>
                    重新加载
                  </button>
                </div>
              )}

              {blogState.status === 'ready' && (
                <>
                  <div className="tag-filter" aria-label="按标签筛选文章">
                    <button
                      className={activeTag === null ? 'is-active' : ''}
                      type="button"
                      onClick={() => setActiveTag(null)}
                    >
                      全部
                    </button>
                    {tags.map((tag) => (
                      <button
                        className={activeTag === tag.slug ? 'is-active' : ''}
                        key={tag.id}
                        type="button"
                        onClick={() => setActiveTag(tag.slug)}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>

                  {featuredPost && (
                    <button
                      className="featured-card"
                      type="button"
                      onClick={() => openArticle(featuredPost.slug)}
                    >
                      <span className="featured-index">精选 / 01</span>
                      <div>
                        <TagList tags={featuredPost.tags} />
                        <h3>{featuredPost.title}</h3>
                        <p>{featuredPost.excerpt}</p>
                      </div>
                      <span className="arrow" aria-label={`阅读 ${featuredPost.title}`}>
                        ↗
                      </span>
                    </button>
                  )}

                  {regularPosts.length > 0 && (
                    <div className="article-grid">
                      {regularPosts.map((post) => (
                        <button
                          className="article-card"
                          key={post.id}
                          type="button"
                          aria-label={`阅读 ${post.title}`}
                          onClick={() => openArticle(post.slug)}
                        >
                          <TagList tags={post.tags} />
                          <h3>{post.title}</h3>
                          <p>{post.excerpt}</p>
                          <footer>
                            <span>{formatDate(post.published_at)}</span>
                            <span>{post.read_time_minutes} min</span>
                          </footer>
                        </button>
                      ))}
                    </div>
                  )}

                  {!featuredPost && <div className="empty-state">这个标签下还没有公开文章。</div>}
                </>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="site-footer">
        <span>Genesis · 个人内容系统</span>
        <span>Blog is the beginning.</span>
      </footer>
    </div>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blog/*" element={<PublicBlog />} />
        <Route path="/articles/:slug" element={<PublicBlog />} />
        <Route path="/tools/*" element={<SystemLanding system="tools" />} />
        <Route path="/media/*" element={<SystemLanding system="media" />} />
        <Route path="/blog/studio/*" element={<Studio />} />`r`n        <Route path="/studio" element={<Navigate to="/blog/studio" replace />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </BrowserRouter>
  )
}


