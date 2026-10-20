import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { getBlogPosts, type BlogPostPreview } from '../../lib/api'

type ReadingState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; posts: BlogPostPreview[] }
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })

export function HomeReading() {
  const [state, setState] = useState<ReadingState>({ status: 'loading' })
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void getBlogPosts(controller.signal, 3).then(data => {
      if (!controller.signal.aborted) setState({ status: 'ready', posts: data.items.slice(0, 3) })
    }).catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => controller.abort()
  }, [reload])

  return <section className="home-reading" aria-labelledby="home-reading-title">
    <div className="home-section-heading"><div><p>从一篇文章开始</p><h2 id="home-reading-title">文章选读</h2></div><Link to="/blog">全部文章<ArrowUpRight aria-hidden="true" size={15} /></Link></div>
    <div className="home-reading-content" aria-busy={state.status === 'loading'}>
      {state.status === 'loading' ? <p className="home-reading-state" role="status">正在读取文章…</p> : state.status === 'error' ? <div className="home-reading-state" role="alert"><p>暂时无法读取文章，你仍可以从上方进入各个空间。</p><button type="button" onClick={() => { setState({ status: 'loading' }); setReload(value => value + 1) }}>重新加载文章</button></div> : !state.posts.length ? <div className="home-reading-state"><p>还没有发布的文章，之后再来看看。</p><Link to="/blog">去博客逛逛<ArrowUpRight aria-hidden="true" size={14} /></Link></div> : <ul>{state.posts.map(post => <li key={post.id}>
        <Link className="home-reading-link" to={`/articles/${encodeURIComponent(post.slug)}`} aria-label={'阅读 ' + post.title}>
          <div className="home-reading-label"><span>{post.is_featured ? '精选文章' : '文章'}</span><ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.5} /></div>
          <div className="home-reading-text"><h3>{post.title}</h3>{post.excerpt && <p>{post.excerpt}</p>}</div>
          <div className="home-reading-meta"><time dateTime={post.published_at}>{dateFormatter.format(new Date(post.published_at))}</time><span>{post.read_time_minutes} 分钟阅读</span></div>
        </Link>
      </li>)}</ul>}
    </div>
  </section>
}
