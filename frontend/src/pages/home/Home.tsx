import { useEffect, useState } from 'react'
import { ArrowUpRight, Pause, Play, UserRound } from 'lucide-react'
import { animate, useMotionValue } from 'motion/react'
import { Link } from 'react-router-dom'
import { GenesisUniverse } from './GenesisUniverse'
import { PortalArtwork } from './PortalArtwork'
import { nearestSolarMinute } from './solarScene'
import { HomeSolarControls } from './HomeSolarControls'
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
  const displayedMinute = useMotionValue(minute)
  const returnMinute = useMotionValue(minute)
  const [returning, setReturning] = useState(false)
  const active = hovered ?? focused
  useEffect(() => { document.title = 'Genesis · 个人空间' }, [])
  useEffect(() => {
    const refresh = () => setNow(new Date())
    const interval = window.setInterval(refresh, 30_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  useEffect(() => {
    if (returning) {
      const controlStart = returnMinute.get()
      const lightStart = ((displayedMinute.get() % 1440) + 1440) % 1440
      // 共用一个进度：滑块和数字从当前显示值出发，背景从当前光照接续，避免任一方跳变。
      const transition = animate(0, 1, {
        duration: motionReduced ? 0 : .95,
        ease: [.4, 0, .2, 1],
        onUpdate: progress => {
          returnMinute.set(controlStart + (minute - controlStart) * progress)
          displayedMinute.set(lightStart + (minute - lightStart) * progress)
        },
        onComplete: () => setReturning(false),
      })
      return () => transition.stop()
    }
    if (motionReduced) { displayedMinute.jump(minute); return }
    const target = nearestSolarMinute(displayedMinute.get(), minute)
    const transition = animate(displayedMinute, target, { type: 'spring', stiffness: 100, damping: 26, restDelta: .01, restSpeed: .05 })
    return () => transition.stop()
  }, [displayedMinute, minute, motionReduced, returnMinute, returning])

  function followLocalTime() {
    if (returning) return
    returnMinute.jump(minute)
    setNow(new Date())
    setPreviewMinute(null)
    setReturning(!motionReduced)
  }

  return <div className="home-page" id="top" data-paused={paused || motionReduced}>
    <GenesisUniverse minute={minute} displayedMinute={displayedMinute} paused={paused || motionReduced} active={active} />
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
        <HomeSolarControls minute={minute} following={previewMinute === null} returning={returning} returnMinute={returnMinute}
          onFollow={followLocalTime} onPreview={value => { setReturning(false); setPreviewMinute(value) }} />
        <button type="button" onClick={() => {
          if (motionReduced) { setAllowMotion(true); setPaused(false) }
          else setPaused(value => !value)
        }} aria-label={motionReduced ? '开启首页动画' : paused ? '播放首页动画' : '暂停首页动画'}>{paused || motionReduced ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{motionReduced ? '开启动画' : paused ? '播放动画' : '暂停动画'}</button>
      </div>
    </main>
  </div>
}

export { Home }
