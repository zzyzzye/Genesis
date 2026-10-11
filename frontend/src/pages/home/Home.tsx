import { useEffect } from 'react'
import { ArrowUp, ArrowUpRight, BookOpen, Clapperboard, Wrench } from 'lucide-react'
import { Link } from 'react-router-dom'
import { HomeReading } from './HomeReading'
import './Home.css'

const systems = [
  { name: '博客', path: '/blog', caption: '阅读与记录', description: '文章、随笔，以及值得回看的想法。', action: '进入博客', icon: BookOpen },
  { name: '工具箱', path: '/toolbox', caption: '日常与效率', description: '收集实用的小工具，正在逐步完善。', action: '查看工具箱', icon: Wrench, status: '筹备中' },
  { name: '影音', path: '/media', caption: '素材与创作', description: '整理素材、编排镜头，把想法做成作品。', action: '进入影音', icon: Clapperboard },
]

function Home() {
  useEffect(() => { document.title = 'Genesis · 个人空间' }, [])

  return (
    <div className="home-page" id="top">
      <a className="home-skip-link" href="#home-main">跳到主要内容</a>
      <header className="home-header">
        <Link className="home-brand" to="/" aria-label="Genesis 首页">Genesis<span>.</span></Link>
        <nav aria-label="主导航">
          {systems.map(system => <Link key={system.path} to={system.path}>{system.name}</Link>)}
        </nav>
        <Link className="home-account" to="/account">账户<ArrowUpRight aria-hidden="true" size={14} /></Link>
      </header>
      <main id="home-main" tabIndex={-1}>
        <section className="home-intro" aria-labelledby="home-title">
          <div>
            <p className="home-kicker">一个持续整理的个人空间</p>
            <h1 id="home-title"><span>记录想法，</span><em>留住日常。</em></h1>
          </div>
          <div className="home-intro-copy">
            <p>文章、日常工具与影音创作，<br />在这里慢慢积累。</p>
          </div>
        </section>
        <section className="home-systems" aria-labelledby="systems-title">
          <div className="home-section-heading">
            <h2 id="systems-title">从这里开始</h2>
            <span>阅读 · 整理 · 创作</span>
          </div>
          <div className="home-system-grid">
            {systems.map(system => <Link className="home-system" key={system.path} to={system.path} aria-label={system.action}>
              <div className="home-system-caption"><system.icon aria-hidden="true" size={21} strokeWidth={1.5} /><span>{system.caption}</span></div>
              <div className="home-system-title"><h3>{system.name}</h3>{system.status && <span>{system.status}</span>}</div>
              <p>{system.description}</p>
              <div className="home-system-action"><span>{system.action}</span><ArrowUpRight aria-hidden="true" size={19} strokeWidth={1.5} /></div>
            </Link>)}
          </div>
        </section>
        <HomeReading />
      </main>
      <footer className="home-footer"><span>Genesis · 个人空间</span><a href="#top">回到顶部<ArrowUp aria-hidden="true" size={14} /></a></footer>
    </div>
  )
}


export { Home }
