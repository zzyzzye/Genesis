import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArticleDocument } from '../../features/blog/ArticleToc'
import { GenesisLogo } from '../../components/GenesisLogo'
import { ApiError, getPublicBlogPage, getPublicBlogPages, type BlogPagePreview, type BlogPagePublic } from '../../lib/api'
import './BlogPage.css'
import './PublicPages.css'

function PageContent({ slug }: { slug?: string }) {
  const [page, setPage] = useState<BlogPagePublic | null>(null)
  const [items, setItems] = useState<BlogPagePreview[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [offset, setOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true); setError(''); setNotFound(false)
      const request = slug ? getPublicBlogPage(slug, abort.signal).then(data => { if (!abort.signal.aborted) setPage(data) })
        : getPublicBlogPages(offset, abort.signal).then(data => { if (!abort.signal.aborted) { setItems(current => offset === 0 ? data.items : [...new Map([...current, ...data.items].map(item => [item.id, item])).values()]); setTotal(data.items.length ? data.total : offset) } })
      void request.catch(reason => { if (!abort.signal.aborted) { setError(reason instanceof Error ? reason.message : '页面暂时无法加载，请重试。'); setNotFound(reason instanceof ApiError && reason.status === 404) } }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    }, 0)
    return () => { window.clearTimeout(timer); abort.abort() }
  }, [slug, offset, refresh])
  useEffect(() => { document.title = `${slug ? notFound ? '页面不存在或尚未发布' : error ? '页面未能打开' : page?.title ?? '正在打开页面' : '页面'} · Genesis` }, [slug, notFound, error, page])
  return <main className="reader-shell blog-pages-reader">
    <Link className="blog-pages-back" to={slug ? '/blog/pages' : '/blog'}>← {slug ? '返回页面目录' : '返回文章列表'}</Link>
    {!slug && <header className="reader-intro"><p className="eyebrow">GENESIS / PAGES</p><h1>页面</h1><p className="reader-summary">关于、站点说明与专题内容。</p></header>}
    {page && <article><header className="reader-intro"><h1>{page.title}</h1>{page.excerpt && <p className="reader-summary">{page.excerpt}</p>}</header><ArticleDocument content={page.content_markdown} label="页面目录" /></article>}
    {!slug && items.length > 0 && <ul className="blog-pages-list" aria-label="公开页面">{items.map(item => <li key={item.id}><Link to={'/blog/pages/' + encodeURIComponent(item.slug)}><h2>{item.title} <span aria-hidden="true">↗</span></h2>{item.excerpt && <p>{item.excerpt}</p>}</Link></li>)}</ul>}
    <div className="blog-pages-feedback" aria-busy={loading}>
      {loading && <p role="status">正在加载页面…</p>}
      {error && <div role="alert"><h2>{notFound ? '页面不存在或尚未发布' : '页面暂时未能加载'}</h2>{!notFound && <><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>重新加载页面</button></>}</div>}
      {!loading && !error && !slug && items.length === 0 && <p>暂时没有公开页面，可以先去读一篇文章。</p>}
      {!loading && !error && !slug && items.length < total && <button type="button" onClick={() => setOffset(offset + 20)}>查看更多页面</button>}
    </div>
  </main>
}

export function PublicPages() {
  const { slug } = useParams<{ slug: string }>()
  return <div className="blog-page">
    <header className="blog-masthead"><Link className="blog-home-link" to="/" aria-label="返回 Genesis 首页"><GenesisLogo /></Link><Link className="blog-wordmark" to="/blog">Genesis Journal</Link><div className="blog-masthead-links"><Link className="blog-account-link" to="/blog/pages">页面</Link><Link className="blog-account-link" to="/account" aria-label="打开账户">账户 ↗</Link></div></header>
    <PageContent key={slug ?? 'index'} slug={slug} />
  </div>
}
