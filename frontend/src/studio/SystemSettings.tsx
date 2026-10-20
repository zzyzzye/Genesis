import { Link, useLocation } from 'react-router-dom'
import { ArrowUpRight, ChevronRight, MousePointer2, UserRound } from 'lucide-react'
import { cursorThemes, useCursorTheme } from '../features/cursor/preferences'
import { CursorSettings } from './CursorSettings'
import { FpsSettings } from './FpsSettings'
import './SystemSettingsHub.css'

const settingsPath = '/blog/studio/settings'

export function SystemSettings() {
  const { pathname } = useLocation()
  const selected = useCursorTheme()
  const theme = cursorThemes.find(item => item.id === selected)!
  const appearance = pathname.replace(/\/$/, '') === `${settingsPath}/appearance`
  const overview = pathname.replace(/\/$/, '') === settingsPath

  return <div className="system-settings">
    <nav className="system-settings__nav" aria-label="设置分类">
      <Link to={settingsPath} aria-current={overview ? 'page' : undefined}>设置总览</Link>
      <Link to={`${settingsPath}/appearance`} aria-current={appearance ? 'page' : undefined}>外观与交互</Link>
      <Link className="system-settings__account" to="/account">账户资料<ArrowUpRight /></Link>
    </nav>
    <div className="system-settings__content">
      {appearance ? <><FpsSettings /><CursorSettings /></> : overview ? <section aria-labelledby="settings-overview-title">
        <header className="system-settings__intro"><h2 id="settings-overview-title">设置总览</h2><p>管理账户资料和当前浏览器的使用偏好。</p></header>
        <section className="system-settings__group" aria-labelledby="settings-account-title"><h3 id="settings-account-title">账户</h3>
          <Link className="system-settings__row" to="/account"><UserRound /><span><strong>账户资料</strong><small>修改昵称、个人简介和头像。</small></span><span className="system-settings__scope">账户设置</span><ArrowUpRight /></Link>
        </section>
        <section className="system-settings__group" aria-labelledby="settings-preferences-title"><h3 id="settings-preferences-title">使用偏好</h3>
          <Link className="system-settings__row" to={`${settingsPath}/appearance`}><MousePointer2 /><span><strong>外观与交互</strong><small>选择光标皮肤与动态效果，预览不同操作状态。</small></span><span className="system-settings__scope">{theme.name}</span><ChevronRight /></Link>
        </section>
      </section> : <section className="system-settings__intro" aria-labelledby="settings-missing-title"><h2 id="settings-missing-title">未找到这个设置页面</h2><p>请从设置分类中选择，或<Link to={settingsPath}>返回设置总览</Link>。</p></section>}
    </div>
  </div>
}
