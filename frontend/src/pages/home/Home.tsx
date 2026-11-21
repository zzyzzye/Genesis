import { useEffect, useState } from 'react'
import { ArrowUpRight, Moon, Pause, Play, RotateCcw, Sun, UserRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GenesisUniverse } from './GenesisUniverse'
import { PortalArtwork } from './PortalArtwork'
import { solarScene } from './solarScene'
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
  const [allowMotion, setAllowMotion] = useState(false)
  const motionReduced = reducedMotion && !allowMotion
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [previewMinute, setPreviewMinute] = useState<number | null>(null)
  const minute = previewMinute ?? now.getHours() * 60 + now.getMinutes()
  const sunlight = solarScene(minute)
  const active = hovered ?? focused
  useEffect(() => { document.title = 'Genesis · 个人空间' }, [])
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const interval = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  return <div className="home-page" id="top" data-paused={paused || motionReduced}>
    <GenesisUniverse minute={minute} paused={paused || motionReduced} />
    <a className="home-skip-link" href="#home-main">跳到主要内容</a>
    <header className="home-header">
      <Link className="home-brand" to="/" aria-label="Genesis 首页"><GenesisLogo inverse /></Link>
      <nav aria-label="主导航">{systems.map(system => <Link key={system.path} to={system.path}>{system.name}</Link>)}</nav>
      <Link className="home-account" to="/account"><UserRound aria-hidden="true" size={16} /><span>账户</span><ArrowUpRight aria-hidden="true" size={14} /></Link>
    </header>
    <main className="home-universe" id="home-main" tabIndex={-1}>
      <div className="home-intro">
        <p className="home-kicker">此刻，自成一个世界</p>
        <h1>好奇心，没有边界。</h1>
        <p className="home-intro-copy">选一个世界，让想法开始旅行。</p>
      </div>
      <div className="home-wordmark" aria-hidden="true">GENESIS</div>
      <nav className="home-portals" aria-label="探索空间">
        {systems.map((system, index) => <Link className={`home-portal home-portal--${system.id}`} key={system.path} to={system.path} aria-label={system.action}
          data-active={active === index} onPointerEnter={() => setHovered(index)} onPointerLeave={() => setHovered(null)} onFocus={() => setFocused(index)} onBlur={() => setFocused(null)}>
          <span className="home-portal-art"><PortalArtwork kind={system.id} reducedMotion={motionReduced} paused={paused} /></span>
          <span className="home-portal-caption"><span className="home-portal-english">{system.english}</span><span className="home-portal-name">{system.name}<ArrowUpRight aria-hidden="true" size={21} strokeWidth={1.4} /></span><span className="home-portal-description">{system.description}</span></span>
        </Link>)}
      </nav>
      <div className="home-universe-controls">
        <div className="home-solar-controls">
          <div className="home-solar-heading">
            <label htmlFor="home-daylight">
              <span className="home-solar-mode">{previewMinute === null ? '本地时间' : '光照预览'}</span>
              <span className="home-solar-reading"><strong>{sunlight.time}</strong><span className="home-solar-phase">{sunlight.label === '夜晚' ? <Moon size={13} aria-hidden="true" /> : <Sun size={13} aria-hidden="true" />}{sunlight.label}</span></span>
            </label>
            <button type="button" className="home-follow-time" aria-label="跟随本地时间" aria-pressed={previewMinute === null} onClick={() => { setNow(new Date()); setPreviewMinute(null) }}>
              {previewMinute === null ? <span className="home-solar-live" aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />}
              {previewMinute === null ? '实时同步' : '回到此刻'}
            </button>
          </div>
          <div className="home-solar-timeline">
            <input id="home-daylight" type="range" min="0" max="1439" step="1" value={minute} aria-label="预览一天的光照" aria-valuetext={`${sunlight.time}，${sunlight.label}`} onChange={event => setPreviewMinute(Number(event.target.value))} />
            <div className="home-solar-ticks" aria-hidden="true">{['00', '06', '12', '18', '24'].map(hour => <span key={hour}>{hour}</span>)}</div>
          </div>
        </div>
        <button type="button" onClick={() => {
          if (motionReduced) { setAllowMotion(true); setPaused(false) }
          else setPaused(value => !value)
        }} aria-label={motionReduced ? '开启首页动画' : paused ? '播放首页动画' : '暂停首页动画'}>{paused || motionReduced ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{motionReduced ? '开启动画' : paused ? '播放动画' : '暂停动画'}</button>
      </div>
    </main>
  </div>
}

export { Home }
