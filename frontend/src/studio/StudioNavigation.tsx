import './StudioNavigation.css'

import { Link } from 'react-router-dom'
import { useLayoutEffect, useRef } from 'react'

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
  const navigationRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const navigation = navigationRef.current
    if (!navigation) return
    function revealCurrentPage() {
      if (!navigation || navigation.scrollWidth <= navigation.clientWidth) return
      const current = navigation.querySelector<HTMLElement>('[aria-current="page"]')
      if (!current) return
      // 只滚动窄屏导航自身，避免切换页面时带动正文。
      navigation.scrollLeft += current.getBoundingClientRect().left - navigation.getBoundingClientRect().left - (navigation.clientWidth - current.offsetWidth) / 2
    }
    revealCurrentPage()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(revealCurrentPage)
    observer.observe(navigation)
    return () => observer.disconnect()
  }, [activeSection])

  return (
    <aside className="studio-section-nav" aria-label="博客管理导航">
      <header className="studio-section-nav__header">
        <Link className="studio-section-nav__brand" to="/blog" aria-label="返回公开博客">
          <span className="studio-section-nav__mark" aria-hidden="true">G<span>.</span></span>
          <span>
            <p>GENESIS</p>
            <strong>博客</strong>
          </span>
        </Link>
        <small>内容工作台</small>
      </header>

      <nav ref={navigationRef} className="studio-nav-groups" aria-label="工作台页面">
        <button className={activeSection === 'overview' ? 'studio-nav-item is-active' : 'studio-nav-item'} aria-current={activeSection === 'overview' ? 'page' : undefined} type="button" onClick={() => onChange('overview')}>
          <StudioIcon name="dashboard" />
          <span>仪表盘</span>
        </button>

        {navigationGroups.map((group) => (
          <div className="studio-nav-group" key={group.id}>
            <p>{group.label}</p>
            {group.items.map((item) => (
              <button className={activeSection === item.id ? 'studio-nav-item is-active' : 'studio-nav-item'} aria-current={activeSection === item.id ? 'page' : undefined} key={item.id} type="button" onClick={() => onChange(item.id)}>
                <StudioIcon name={item.icon} />
                <span>{item.label}</span>
                {!['posts', 'categories', 'tags'].includes(item.id) && <em>筹备</em>}
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
