import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Bot, ChevronRight, FolderOpen, Images, Menu, Plus, UserRound, X } from 'lucide-react'
import { GenesisLogo } from '../../components/GenesisLogo'
import { SpaceLinks } from '../../components/SpaceLinks'
import { FpsStatusSlot } from '../../features/performance/FpsMonitor'
import { AnimatePresence } from 'motion/react'
import { MediaDialog, MediaSurface } from './MediaMotion'
import { ProjectDialog, type ProjectAction } from './ProjectDialog'
import { useMediaProjects, type MediaProjectCollection } from './useMediaProjects'
import './MediaLayout.css'

export type CreateMediaProject = () => void

function Navigation({ projectId, onNavigate }: { projectId?: string; onNavigate?: () => void }) {
  const location = useLocation()
  const assets = !projectId && location.pathname.endsWith('/assets')
  return <>
    <nav aria-label="创作空间">
      <span className="media-home-nav-label">制作空间</span>
      <Link to="/media" aria-current={!assets ? 'page' : undefined} onClick={onNavigate}><FolderOpen aria-hidden="true" /><span>作品</span></Link>
      <Link to="/media/assets" aria-current={assets ? 'page' : undefined} onClick={onNavigate}><Images aria-hidden="true" /><span>素材库</span></Link>
      <span className="media-home-nav-label">其他空间</span>
      <SpaceLinks current="media" onNavigate={onNavigate} />
    </nav>
    <div className="media-home-sidebar-bottom">
      <button className="media-home-sidebar-assistant" onClick={() => { onNavigate?.(); window.dispatchEvent(new Event('genesis:open-media-assistant')) }}><Bot aria-hidden="true" />镜头搭档<span className="media-home-tag">AI</span></button>
      <Link to="/" onClick={onNavigate}><ArrowLeft aria-hidden="true" />返回 Genesis</Link>
    </div>
  </>
}

function MobileNavigation({ projectId, onClose }: { projectId?: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  return <MediaDialog initialFocus={close} navigation className="media-mobile-navigation" aria-label="影音导航菜单" onCancel={event => { event.preventDefault(); onClose() }} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="media-mobile-navigation-panel">
      <header><GenesisLogo inverse /><button ref={close} aria-label="收起导航" onClick={onClose}><X /></button></header>
      <Navigation projectId={projectId} onNavigate={onClose} />
    </div>
  </MediaDialog>
}

export function MediaLayout({ projectId, children }: { projectId?: string; children: (create: CreateMediaProject, projects: MediaProjectCollection) => ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [action, setAction] = useState<ProjectAction | null>(null)
  const assets = location.pathname.endsWith('/assets')
  const collection = useMediaProjects(!projectId && !assets)
  const title = projectId ? assets ? '作品素材' : '作品概览' : assets ? '素材库' : '作品'
  const create: CreateMediaProject = () => { setMobileOpen(false); setAction({ kind: 'create' }) }

  useEffect(() => { document.title = `${title} · Genesis 影音` }, [title])
  useEffect(() => {
    if (projectId || assets) return
    const params = new URLSearchParams(location.search)
    if (params.get('view') !== 'projects') return
    // 旧项目库地址归并到作品列表，保留搜索和锚点，不增加历史记录。
    params.delete('view')
    void navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true })
  }, [projectId, assets, location.pathname, location.search, location.hash, navigate])
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(min-width: 761px)')
    const close = () => { if (media.matches) setMobileOpen(false) }
    media.addEventListener('change', close)
    return () => media.removeEventListener('change', close)
  }, [])

  return <div className="media-home media-layout">
    <aside className="media-home-sidebar" aria-label="影音导航">
      <Link className="media-home-brand" to="/" aria-label="Genesis 首页"><GenesisLogo inverse /><span className="media-home-brand-label">STUDIO</span></Link>
      <Navigation projectId={projectId} />
    </aside>
    <div className="media-home-main">
      <header className="media-home-topbar">
        <button className="media-home-mobile-toggle" aria-label="展开导航" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu /></button>
        <div className="media-home-breadcrumb"><Link to="/media">影音空间</Link><ChevronRight />{projectId && <><Link to="/media">作品</Link><ChevronRight /></>}<span>{title}</span></div>
        <div className="media-home-topbar-actions"><FpsStatusSlot /><Link className="media-home-account" to="/account" aria-label="账户设置"><UserRound /></Link><button className="media-home-primary" onClick={create}><Plus />新建作品</button></div>
      </header>
      <main className="media-layout-content"><MediaSurface key={location.pathname}>{children(create, collection)}</MediaSurface></main>
    </div>
    <AnimatePresence>{mobileOpen && <MobileNavigation key="navigation" projectId={projectId} onClose={() => setMobileOpen(false)} />}</AnimatePresence>
    <AnimatePresence>{action && <ProjectDialog key={action.kind} action={action} onClose={() => setAction(null)} onSaved={project => { setAction(null); if (project) void navigate(`/media/projects/${project.id}`) }} />}</AnimatePresence>
  </div>
}
