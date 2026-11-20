import { useEffect, useState } from 'react'
import { ArrowUpRight, Pause, Play, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GenesisUniverse } from './GenesisUniverse'
import { PortalArtwork } from './PortalArtwork'
import { GenesisLogo } from '../../components/GenesisLogo'
import { useLiveReducedMotion } from '../../lib/motion'
import './Home.css'

// 门面只承载探索入口，具体业务仍在各自空间内完成。

const systems = [
  { id: 'journal', name: '博客', english: 'JOURNAL', path: '/blog', description: '文字，让思想有迹可循。', action: '进入博客' },
  { id: 'lab', name: '工具箱', english: 'LABORATORY', path: '/toolbox', description: '动手，把好奇变成可能。', action: '查看工具箱' },
  { id: 'studio', name: '影音', english: 'STUDIO', path: '/media', description: '影像，让想象成为现实。', action: '进入影音' },
] as const

function Home() {
  const reducedMotion = useLiveReducedMotion()
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const active = hovered ?? focused
  useEffect(() => { document.title = 'Genesis · 个人空间' }, [])

  return <div className="home-page" id="top" data-paused={paused || reducedMotion}>
    <a className="home-skip-link" href="#home-main">跳到主要内容</a>
    <header className="home-header">
      <Link className="home-brand" to="/" aria-label="Genesis 首页"><GenesisLogo inverse /></Link>
      <nav aria-label="主导航">{systems.map(system => <Link key={system.path} to={system.path}>{system.name}</Link>)}</nav>
      <Link className="home-account" to="/account"><UserRound aria-hidden="true" size={16} /><span>账户</span><ArrowUpRight aria-hidden="true" size={14} /></Link>
    </header>
    <main className="home-universe" id="home-main" tabIndex={-1}>
      <GenesisUniverse active={active} paused={paused || reducedMotion} />
      <div className="home-intro">
        <p className="home-kicker">一个人的数字宇宙</p>
        <h1>好奇心，没有边界。</h1>
        <p className="home-intro-copy">选一个世界，让想法开始旅行。</p>
      </div>
      <div className="home-wordmark" aria-hidden="true">GENESIS</div>
      <nav className="home-portals" aria-label="探索空间">
        {systems.map((system, index) => <Link className={`home-portal home-portal--${system.id}`} key={system.path} to={system.path} aria-label={system.action}
          data-active={active === index} onPointerEnter={() => setHovered(index)} onPointerLeave={() => setHovered(null)} onFocus={() => setFocused(index)} onBlur={() => setFocused(null)}>
          <span className="home-portal-art"><PortalArtwork kind={system.id} reducedMotion={reducedMotion} /></span>
          <span className="home-portal-caption"><span className="home-portal-english">{system.english}</span><span className="home-portal-name">{system.name}<ArrowUpRight aria-hidden="true" size={21} strokeWidth={1.4} /></span><span className="home-portal-description">{system.description}</span></span>
          <span className="home-portal-enter" aria-hidden="true">{system.action}<ArrowUpRight size={14} /></span>
        </Link>)}
      </nav>
      <div className="home-universe-controls">
        <span className="home-navigation-hint">三个世界，同一份好奇。<span>点击入口，启程探索</span></span>
        {!reducedMotion && <button type="button" onClick={() => setPaused(value => !value)} aria-label={paused ? '播放星轨动画' : '暂停星轨动画'}>{paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{paused ? '播放星轨' : '暂停星轨'}</button>}
      </div>
    </main>
  </div>
}

export { Home }
