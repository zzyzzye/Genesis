import { Link } from 'react-router-dom'

import type { CurrentUser } from '../lib/api'
import { StudioIcon } from './StudioIcon'
import { navigationGroups, type StudioSection } from './StudioNavigationModel'

export function StudioNavigation({
  activeSection,
  onChange,
  onLogout,
  user,
}: {
  activeSection: StudioSection
  onChange: (section: StudioSection) => void
  onLogout: () => void
  user: CurrentUser
}) {
  return (
    <aside className="studio-section-nav" aria-label="博客管理导航">
      <header className="studio-section-nav__header">
        <Link className="studio-section-nav__brand" to="/" aria-label="返回 Genesis 首页">
          <span className="studio-section-nav__mark" aria-hidden="true">G<span>.</span></span>
          <span>
            <p>GENESIS</p>
            <strong>博客</strong>
          </span>
        </Link>
        <small>内容工作台</small>
      </header>

      <button className="studio-nav-search" type="button">
        <StudioIcon name="search" />
        <span>搜索内容</span>
        <kbd>Ctrl K</kbd>
      </button>

      <nav className="studio-nav-groups">
        <button className={activeSection === 'overview' ? 'studio-nav-item is-active' : 'studio-nav-item'} type="button" onClick={() => onChange('overview')}>
          <StudioIcon name="dashboard" />
          <span>仪表盘</span>
        </button>

        {navigationGroups.map((group) => (
          <div className="studio-nav-group" key={group.id}>
            <p>{group.label}</p>
            {group.items.map((item) => (
              <button className={activeSection === item.id ? 'studio-nav-item is-active' : 'studio-nav-item'} key={item.id} type="button" onClick={() => onChange(item.id)}>
                <StudioIcon name={item.icon} />
                <span>{item.label}</span>
                {item.id === 'comments' ? <em>0</em> : <StudioIcon className="studio-nav-chevron" name="chevron" />}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <footer className="studio-section-account">
        <div className="studio-user-avatar" aria-hidden="true">{user.display_name.slice(0, 1)}</div>
        <div>
          <strong>{user.display_name}</strong>
          <small>@{user.handle}</small>
        </div>
        <button type="button" onClick={onLogout} aria-label="退出登录"><StudioIcon name="logout" /></button>
      </footer>
    </aside>
  )
}
