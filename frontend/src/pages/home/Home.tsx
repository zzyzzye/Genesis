import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Pause, Play, Shuffle, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { HomeReading } from './HomeReading'
import { GenesisSculpture } from './GenesisSculpture'
import { GenesisLogo } from '../../components/GenesisLogo'
import { useLiveReducedMotion } from '../../lib/motion'
import './Home.css'

// 门面只承载探索入口，具体业务仍在各自空间内完成。

const systems = [
  { name: '博客', english: 'Journal', path: '/blog', description: '把思考写下来', action: '进入博客' },
  { name: '工具箱', english: 'Laboratory', path: '/toolbox', description: '让好奇心动手', action: '查看工具箱' },
  { name: '影音', english: 'Studio', path: '/media', description: '给灵感一个形状', action: '进入影音' },
]

function Home() {
  const reducedMotion = useLiveReducedMotion()
  const [paused, setPaused] = useState(false)
  const [form, setForm] = useState<0 | 1>(0)
  useEffect(() => { document.title = 'Genesis · 个人空间' }, [])

  return <div className="home-page" id="top">
    <a className="home-skip-link" href="#home-main">跳到主要内容</a>
    <header className="home-header">
      <Link className="home-brand" to="/" aria-label="Genesis 首页"><GenesisLogo inverse /></Link>
      <nav aria-label="主导航">{systems.map(system => <Link key={system.path} to={system.path}>{system.name}</Link>)}</nav>
      <Link className="home-account" to="/account"><UserRound aria-hidden="true" size={16} /><span>账户</span><ArrowUpRight aria-hidden="true" size={14} /></Link>
    </header>
    <main id="home-main" tabIndex={-1}>
      <section className="home-hero" aria-label="欢迎来到 Genesis">
        <div className="home-hero-stage">
          <GenesisSculpture form={form} paused={paused || reducedMotion} />
          <div className="home-intro">
            <p className="home-kicker"><span />一个人的数字宇宙</p>
            <h1>让想法，<br /><span>发生。</span><i aria-hidden="true">*</i></h1>
            <p className="home-intro-copy">写一点代码，记一些想法。<br />在理性与想象之间，造点有意思的东西。</p>
            <a className="home-explore" href="#home-spaces">探索我的空间<ArrowDown aria-hidden="true" size={17} /></a>
          </div>
          <div className="home-art-caption">
            <span className="home-art-name">{form === 0 ? '环流' : '星核'}<span aria-hidden="true"> / {form === 0 ? 'ORBIT' : 'CORE'}</span></span>
            <span className="home-art-hint">{reducedMotion ? '静态光雕 · 已遵循系统动画偏好' : '移动鼠标，轻轻拨动光轨'}</span>
            <div className="home-art-controls">
              <button type="button" onClick={() => setForm(value => value === 0 ? 1 : 0)} aria-label="切换光雕形态"><Shuffle size={14} aria-hidden="true" />切换形态</button>
              {!reducedMotion && <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? '播放光雕动画' : '暂停光雕动画'}>{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{paused ? '播放' : '暂停'}</button>}
            </div>
          </div>
        </div>
        <div className="home-hero-signature" aria-hidden="true"><span>GENESIS</span><p>保持好奇<br />保持创造</p></div>
        <nav className="home-spaces" id="home-spaces" aria-label="探索空间" tabIndex={-1}>
          {systems.map(system => <Link className="home-space" key={system.path} to={system.path} aria-label={system.action}>
            <span className="home-space-name"><span>{system.english}</span><strong>{system.name}</strong></span>
            <span className="home-space-description">{system.description}</span><ArrowUpRight aria-hidden="true" size={22} strokeWidth={1.3} />
          </Link>)}
        </nav>
      </section>
      <HomeReading />
    </main>
    <footer className="home-footer"><span>Genesis · 思考与创造的自留地</span><a href="#top">回到顶部<ArrowUp aria-hidden="true" size={14} /></a></footer>
  </div>
}

export { Home }
