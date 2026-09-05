import { Link } from 'react-router-dom'

import type { CurrentUser } from '../lib/api'
import { StudioIcon, type StudioIconName } from './StudioIcon'

export type StudioSection = 'overview' | 'posts' | 'pages' | 'comments' | 'attachments' | 'links' | 'themes' | 'menus' | 'users' | 'settings'

type NavigationItem = { id: StudioSection; label: string; icon: StudioIconName; badge?: string }

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: '内容管理',
    items: [
      { id: 'posts', label: '文章', icon: 'articles' },
      { id: 'pages', label: '页面', icon: 'pages' },
      { id: 'comments', label: '评论', icon: 'comments', badge: '0' },
      { id: 'attachments', label: '附件', icon: 'attachment' },
      { id: 'links', label: '链接', icon: 'link' },
    ],
  },
  {
    label: '外观设计',
    items: [
      { id: 'themes', label: '主题', icon: 'palette' },
      { id: 'menus', label: '菜单', icon: 'menu' },
    ],
  },
  {
    label: '系统管理',
    items: [
      { id: 'users', label: '用户', icon: 'user' },
      { id: 'settings', label: '设置', icon: 'settings' },
    ],
  },
]

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
    <>
      <aside className="studio-system-rail" aria-label="一级系统导航">
        <Link className="studio-rail-brand" to="/" aria-label="返回 Genesis 首页"><span className="studio-rail-brand__wordmark">G<span>.</span></span></Link>
        <span className="studio-level-mark">一级</span>
        <nav className="studio-rail-systems">
          <button className="is-active" type="button" onClick={() => onChange('overview')} aria-label="博客系统">
            <StudioIcon name="articles" />
            <span>博客</span>
          </button>
          <Link to="/tools" aria-label="工具系统">
            <StudioIcon name="tools" />
            <span>工具</span>
          </Link>
          <Link to="/media" aria-label="视频系统">
            <StudioIcon name="media" />
            <span>视频</span>
          </Link>
        </nav>
        <div className="studio-rail-bottom">
          <button type="button" onClick={() => onChange('settings')} aria-label="设置"><StudioIcon name="settings" /></button>
          <button className="studio-rail-avatar" type="button" onClick={() => onChange('users')} aria-label="用户中心">
            {user.display_name.slice(0, 1)}
          </button>
        </div>
      </aside>

      <aside className="studio-section-nav" aria-label="二级博客管理导航">
        <header className="studio-section-nav__header">
          <div>
            <span className="studio-level-mark">二级</span>
            <p>GENESIS STUDIO</p>
          </div>
          <strong>博客系统</strong>
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
            <div className="studio-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <button className={activeSection === item.id ? 'studio-nav-item is-active' : 'studio-nav-item'} key={item.id} type="button" onClick={() => onChange(item.id)}>
                  <StudioIcon name={item.icon} />
                  <span>{item.label}</span>
                  {item.badge ? <em>{item.badge}</em> : <StudioIcon className="studio-nav-chevron" name="chevron" />}
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
    </>
  )
}
