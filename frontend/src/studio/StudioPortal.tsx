import './StudioPortal.css'

import { Link } from 'react-router-dom'
import { StudioIcon, type StudioIconName } from './StudioIcon'

type PortalSystem = {
  id: string
  title: string
  description: string
  icon: StudioIconName
} & ({ status: 'available'; href: string } | { status: 'building' })

const systems: PortalSystem[] = [
  { id: 'blog', title: '博客', description: '写作、整理与发布文章。', href: '/studio/blog', icon: 'articles', status: 'available' },
  { id: 'media', title: '影音', description: '编排镜头，管理作品素材。', href: '/media', icon: 'media', status: 'available' },
  { id: 'tools', title: '工具集', description: '文本处理与开发辅助，正在筹备。', icon: 'tools', status: 'building' },
]

function WorkspaceContents({ system }: { system: PortalSystem }) {
  return <>
    <StudioIcon className="studio-portal-card__icon" name={system.icon} />
    <div className="studio-portal-card__copy">
      <h2>{system.title}</h2>
      <p>{system.description}</p>
    </div>
    <span className="studio-portal-card__action">
      {system.status === 'available' ? <><span>进入</span><StudioIcon name="arrow-right" /></> : '筹备中'}
    </span>
  </>
}

export function StudioPortal() {
  return (
    <div className="studio-portal">
      <header className="studio-portal__header">
        <Link className="studio-portal__brand" to="/" aria-label="返回 Genesis 公开首页">
          <span aria-hidden="true">G.</span><strong>Genesis</strong>
        </Link>
        <Link className="studio-portal__account" to="/account">账户<StudioIcon name="user" /></Link>
      </header>
      <main className="studio-portal__main">
        <section className="studio-portal__intro" aria-labelledby="studio-portal-title">
          <p className="studio-portal__label">你的创作空间</p>
          <h1 id="studio-portal-title">选择工作区</h1>
          <p className="studio-portal__lead">从一个想法开始，<br />把内容慢慢做成自己的作品。</p>
          <span className="studio-portal__hint">写作、编排与日常工具，各有一处安静的空间。</span>
        </section>
        <nav className="studio-portal__systems" aria-label="系统导航">
          {systems.map((system) => system.status === 'available' ? (
            <Link className="studio-portal-card" key={system.id} to={system.href}>
              <WorkspaceContents system={system} />
            </Link>
          ) : (
            <article className="studio-portal-card studio-portal-card--building" key={system.id}>
              <WorkspaceContents system={system} />
            </article>
          ))}
        </nav>
      </main>
      <footer className="studio-portal__footer">
        <span>Genesis · 个人工作台</span>
        <Link to="/">返回公开首页<StudioIcon name="arrow-up-right" /></Link>
      </footer>
    </div>
  )
}
