import './StudioPortal.css'

import { Link } from 'react-router-dom'

import { StudioIcon, type StudioIconName } from './StudioIcon'

type PortalSystem = {
  id: string
  index: string
  title: string
  eyebrow: string
  description: string
  href: string
  icon: StudioIconName
  status: 'available' | 'building'
}

const systems: PortalSystem[] = [
  {
    id: 'blog',
    index: '01',
    title: '博客',
    eyebrow: 'CONTENT STUDIO',
    description: '写作、整理和发布长期内容，在文章所在的页面调用博客助手。',
    href: '/blog/studio',
    icon: 'articles',
    status: 'available',
  },
  {
    id: 'tools',
    index: '02',
    title: '工具集',
    eyebrow: 'UTILITY WORKSPACE',
    description: '管理日常工具、收藏和可复用的工作流程。',
    href: '/tools/studio',
    icon: 'attachment',
    status: 'building',
  },
  {
    id: 'media',
    index: '03',
    title: '影音',
    eyebrow: 'MEDIA CENTER',
    description: '管理 LivTV、Bilibili 作者和个人观看记录。',
    href: '/media/studio',
    icon: 'eye',
    status: 'building',
  },
]

export function StudioPortal() {
  return (
    <div className="studio-portal">
      <header className="studio-portal__header">
        <Link className="studio-portal__brand" to="/" aria-label="返回 Genesis 公开首页">
          <span>G<span>.</span></span>
          <strong>Genesis</strong>
        </Link>
        <div className="studio-portal__header-copy">
          <span>个人系统</span>
          <small>选择一个工作区继续</small>
        </div>
        <Link className="studio-portal__public-link" to="/">
          查看公开站点 <StudioIcon name="arrow-up-right" />
        </Link>
      </header>

      <main className="studio-portal__main">
        <section className="studio-portal__intro" aria-labelledby="studio-portal-title">
          <p>GENESIS / SYSTEMS</p>
          <h1 id="studio-portal-title">从这里进入<br />你的每个系统。</h1>
          <span>首页只负责导航。进入模块后，内容、操作和 Agent 都留在各自的工作区。</span>
        </section>

        <nav className="studio-portal__systems" aria-label="系统导航">
          {systems.map((system) => (
            <Link
              className={`studio-portal-card studio-portal-card--${system.id}`}
              key={system.id}
              to={system.href}
            >
              <span className="studio-portal-card__index">{system.index}</span>
              <span className="studio-portal-card__icon"><StudioIcon name={system.icon} /></span>
              <span className="studio-portal-card__copy">
                <small>{system.eyebrow}</small>
                <strong>{system.title}</strong>
                <em>{system.description}</em>
              </span>
              <span className={`studio-portal-card__status is-${system.status}`}>
                {system.status === 'available' ? '进入系统' : '建设中'}
                <StudioIcon name="chevron" />
              </span>
            </Link>
          ))}
        </nav>
      </main>

      <footer className="studio-portal__footer">
        <span>一个入口，多个彼此独立的工作区</span>
        <span>GENESIS OS · 2026</span>
      </footer>
    </div>
  )
}
