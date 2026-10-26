import { ArrowLeft, ArrowUpRight, ShieldCheck, UserRound, Wallet } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { GenesisLogo } from '../../components/GenesisLogo'
import type { CurrentUser } from '../../lib/api'
import '../../Account.css'
import './AccountWorkspace.css'

export function AccountWorkspace({ user, active, children }: {
  user: CurrentUser | null
  active: 'profile' | 'wallet' | 'billing'
  children: ReactNode
}) {
  const items = [
    { id:'profile',name:'个人资料',path:'/account',icon:UserRound },
    { id:'wallet',name:'我的钱包',path:'/account/wallet',icon:Wallet },
    ...(user?.role === 'owner' ? [{ id:'billing',name:'账务管理',path:'/account/billing',icon:ShieldCheck }] : []),
  ]
  return <div className="account-shell account-workspace">
    <aside className="account-workspace-sidebar">
      <Link className="account-workspace-brand" to="/" aria-label="Genesis 首页"><GenesisLogo /></Link>
      <div className="account-workspace-navigation"><p>个人空间</p><nav aria-label="账户服务">
        {items.map(item => <Link key={item.id} to={item.path} aria-current={active === item.id ? 'page' : undefined}><item.icon size={18} strokeWidth={1.6} aria-hidden="true" />{item.name}</Link>)}
      </nav></div>
      <div className={`account-workspace-bottom${user?.role === 'owner' ? ' account-workspace-bottom--owner' : ''}`}>
        {user && <div className="account-workspace-user"><strong>{user.display_name}</strong><span>@{user.handle}</span></div>}
        {user?.role === 'owner' && <Link to="/blog/studio">进入写作台<ArrowUpRight size={15} aria-hidden="true" /></Link>}
        <Link to="/media"><ArrowLeft size={15} aria-hidden="true" />返回创作空间</Link>
      </div>
    </aside>
    <main className="account-workspace-main">{children}<footer className="account-workspace-footer">Genesis · 你的个人空间</footer></main>
  </div>
}
