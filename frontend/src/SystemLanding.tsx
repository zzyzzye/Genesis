import { Link } from 'react-router-dom'


type SystemKey = 'blog' | 'tools' | 'media'

const systems: Record<SystemKey, { title: string; index: string; description: string; apiPath: string }> = {
  blog: { title: '博客', index: '01', description: '沉淀值得反复回看的想法、文章与长期记录。', apiPath: '/blog' },
  tools: { title: '工具', index: '02', description: '把重复的工作整理成可以直接使用的小工具。', apiPath: '/tools' },
  media: { title: '影音', index: '03', description: '记录正在发生的现场、声音和影像。', apiPath: '/media' },
}

export function SystemLanding({ system }: { system: SystemKey }) {
  const config = systems[system]
  return (
    <div className="page" id="top">
      <header className="site-header">
        <Link className="brand" to="/">Genesis<span>.</span></Link>
        <nav aria-label="主导航"><Link to="/blog">博客</Link><Link to="/tools">工具</Link><Link to="/media">影音</Link></nav>
        <span className="module-state">{config.index} / {config.title}</span>
      </header>
      <main className="module-placeholder">
        <p className="eyebrow">GENESIS / {config.index} / {config.apiPath}</p>
        <h1>{config.title}<em>正在生长。</em></h1>
        <p>{config.description}</p>
        <Link className="primary-button" to="/">返回 Genesis 首页 <span aria-hidden="true">→</span></Link>

      </main>
    </div>
  )
}
