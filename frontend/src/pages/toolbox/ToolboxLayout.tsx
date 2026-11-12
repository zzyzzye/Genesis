import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, BookOpen, ChevronRight, Clapperboard, CodeXml, LayoutGrid, Menu, PanelLeftClose, PanelLeftOpen, UserRound, X } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { GenesisLogo } from '../../components/GenesisLogo'
import { FpsStatusSlot } from '../../features/performance/FpsMonitor'
import { useModalDialog } from '../../studio/useModalDialog'
import './ToolboxLayout.css'

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  return <nav aria-label="工具箱导航" onClick={onNavigate}>
    <span className="toolbox-nav-label">实用工具</span>
    <NavLink to="/toolbox" end title="全部工具"><LayoutGrid /><span>全部工具</span></NavLink>
    <NavLink to="/toolbox/svg" title="SVG 生成器"><CodeXml /><span>SVG 生成器</span></NavLink>
    <span className="toolbox-nav-label">其他空间</span>
    <Link to="/media" title="媒体创作"><Clapperboard /><span>媒体创作</span></Link>
    <Link to="/blog" title="博客阅读"><BookOpen /><span>博客阅读</span></Link>
    <Link to="/account" title="我的账户"><UserRound /><span>我的账户</span></Link>
  </nav>
}

function MobileNavigation({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  const dialog = useModalDialog(close)
  return <dialog ref={dialog} className="toolbox-mobile-nav" aria-label="工具箱导航菜单" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    <div><header><GenesisLogo /><button ref={close} aria-label="关闭导航" onClick={onClose}><X /></button></header><Navigation onNavigate={onClose} /><Link className="toolbox-back" to="/" onClick={onClose}><ArrowLeft />返回 Genesis</Link></div>
  </dialog>
}

export function ToolboxLayout({ children, detail = false }: { children: ReactNode; detail?: boolean }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => {
    if (!window.matchMedia) return
    const media = window.matchMedia('(max-width: 800px)')
    const update = () => { if (!media.matches) setMobileOpen(false) }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => { document.title = `${detail ? 'SVG 生成器' : '工具箱'} · Genesis` }, [detail])
  return <div className={`toolbox-layout${collapsed ? ' toolbox-layout--collapsed' : ''}`}>
    <aside className="toolbox-sidebar" aria-label="工具箱侧栏"><Link className="toolbox-brand" to="/" aria-label="Genesis 首页"><GenesisLogo markOnly={collapsed} />{!collapsed && <span>工具箱</span>}</Link><Navigation /><div className="toolbox-sidebar-bottom"><Link className="toolbox-back" to="/" title="返回 Genesis"><ArrowLeft /><span>返回 Genesis</span></Link><button className="toolbox-collapse" aria-label={collapsed ? '展开侧栏' : '收起侧栏'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}{!collapsed && <span>收起侧栏</span>}</button></div></aside>
    <div className="toolbox-body"><header className="toolbox-topbar"><button className="toolbox-mobile-toggle" aria-label="展开导航" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)}><Menu /></button><div className="toolbox-breadcrumb"><Link to="/toolbox">工具箱</Link><ChevronRight /><span>{detail ? 'SVG 生成器' : '全部工具'}</span></div><div className="toolbox-topbar-actions"><FpsStatusSlot /><Link to="/account" aria-label="账户设置"><UserRound /></Link></div></header><main className="toolbox-content">{children}</main></div>
    {mobileOpen && <MobileNavigation onClose={() => setMobileOpen(false)} />}
  </div>
}
