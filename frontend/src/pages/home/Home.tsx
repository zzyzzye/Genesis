import { useEffect } from 'react'
import { ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Clapperboard, UserRound, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { HomeReading } from './HomeReading'
import './Home.css'

const systems = [
  { name: '博客', path: '/blog', description: '技术实践、产品思考与日常随笔', action: '进入博客', icon: BookOpen },
  { name: '工具箱', path: '/toolbox', description: '收集日常所需，让琐事简单一点', action: '查看工具箱', icon: Wrench, status: '筹备中' },
  { name: '影音', path: '/media', description: '整理素材，把灵感编排成作品', action: '进入影音', icon: Clapperboard },
]

function Home() {
  useEffect(() => { document.title = 'Genesis · 个人空间' }, [])

  return (
    <div className="home-page" id="top">
      <a className="home-skip-link" href="#home-main">跳到主要内容</a>
      <header className="home-header">
        <Link className="home-brand" to="/" aria-label="Genesis 首页"><span className="home-brand-mark" aria-hidden="true">g</span>Genesis</Link>
        <nav aria-label="主导航">
          {systems.map(system => <Link key={system.path} to={system.path}>{system.name}</Link>)}
        </nav>
        <Link className="home-account" to="/account"><UserRound aria-hidden="true" size={17} />账户<ArrowUpRight aria-hidden="true" size={14} /></Link>
      </header>
      <main id="home-main" tabIndex={-1}>
        <section className="home-overview" aria-label="欢迎来到 Genesis">
          <div className="home-intro">
            <p className="home-kicker"><span aria-hidden="true" />一个持续生长的个人空间</p>
            <h1 id="home-title">记录，探索，<br /><span>慢慢创造。</span></h1>
            <p className="home-intro-copy">在文章里梳理想法，用工具处理日常，<br className="home-copy-break" />把闪过的灵感，变成留得下来的作品。</p>
            <Link className="home-start-reading" to="/blog">开始阅读<ArrowRight aria-hidden="true" size={17} /></Link>
          </div>
          <section className="home-systems" aria-labelledby="systems-title">
            <div className="home-spaces-heading"><h2 id="systems-title">探索空间</h2><span>阅读 / 整理 / 创作</span></div>
            <div className="home-system-list">
              {systems.map(system => <Link className="home-system" key={system.path} to={system.path} aria-label={system.action}>
                <span className="home-system-icon"><system.icon aria-hidden="true" size={24} strokeWidth={1.6} /></span>
                <div className="home-system-copy">
                  <div className="home-system-title"><h3>{system.name}</h3>{system.status && <span>{system.status}</span>}</div>
                  <p>{system.description}</p>
                </div>
                <ArrowUpRight className="home-system-arrow" aria-hidden="true" size={20} strokeWidth={1.6} />
              </Link>)}
            </div>
          </section>
        </section>
        <HomeReading />
      </main>
      <footer className="home-footer"><span>Genesis · 个人空间</span><a href="#top">回到顶部<ArrowUp aria-hidden="true" size={14} /></a></footer>
    </div>
  )
}


export { Home }
