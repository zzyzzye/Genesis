import { ArrowUpRight, Clapperboard, LogOut, PenLine, ShieldCheck, UserRound, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { GenesisLogo } from '../../components/GenesisLogo'
import type { CurrentUser } from '../../lib/api'
import '../../Account.css'
import './AccountWorkspace.css'

export function AccountWorkspace({ user, active, children, onLogout, logoutDisabled = false }: {
  user: CurrentUser | null
  active: 'profile' | 'wallet' | 'billing'
  children: ReactNode
  onLogout?: () => void
  logoutDisabled?: boolean
}) {
  const items = [
    { id:'profile',name:'个人资料',path:'/account',icon:UserRound },
    { id:'wallet',name:'我的钱包',path:'/account/wallet',icon:Wallet },
    ...(user?.role === 'owner' ? [{ id:'billing',name:'账务管理',path:'/account/billing',icon:ShieldCheck }] : []),
  ]
  return <div className={`account-shell account-workspace account-workspace--${active}`}>
    <aside className="account-workspace-sidebar">
      <Link className="account-workspace-brand" to="/" aria-label="Genesis 首页"><GenesisLogo /></Link>
      <div className="account-workspace-navigation"><p>个人空间</p><nav aria-label="账户服务">
        {items.map(item => <Link key={item.id} to={item.path} aria-current={active === item.id ? 'page' : undefined}><item.icon size={18} strokeWidth={1.6} aria-hidden="true" />{item.name}</Link>)}
      </nav></div>
      <div className="account-workspace-shortcuts"><p>创作</p><nav aria-label="创作入口">
        <Link to="/media"><Clapperboard size={17} strokeWidth={1.6} aria-hidden="true" /><span>返回创作空间</span><ArrowUpRight size={13} aria-hidden="true" /></Link>
        {user?.role === 'owner' && <Link to="/blog/studio"><PenLine size={17} strokeWidth={1.6} aria-hidden="true" /><span>进入写作台</span><ArrowUpRight size={13} aria-hidden="true" /></Link>}
      </nav></div>
      <div className="account-workspace-bottom">
        {user && <div className="account-workspace-user"><span className="account-workspace-monogram" aria-hidden="true">{user.display_name?.slice(0,1) || 'G'}</span><div><strong title={user.display_name}>{user.display_name}</strong><span title={`@${user.handle}`}>@{user.handle}</span></div></div>}
        {onLogout && <button className="account-workspace-logout" type="button" disabled={logoutDisabled} onClick={onLogout}><LogOut size={16} aria-hidden="true" />退出登录</button>}
      </div>
    </aside>
    <main className="account-workspace-main">{children}<footer className="account-workspace-footer">Genesis · 你的个人空间</footer></main>
  </div>
}
