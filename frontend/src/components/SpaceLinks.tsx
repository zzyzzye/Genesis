import { BookOpen, Clapperboard, LayoutGrid } from 'lucide-react'
import { Link } from 'react-router-dom'

const spaces = [
  { id: 'blog', path: '/blog', label: '博客', icon: BookOpen },
  { id: 'media', path: '/media', label: '媒体', icon: Clapperboard },
  { id: 'toolbox', path: '/toolbox', label: '工具箱', icon: LayoutGrid },
] as const

/** 各空间共用切换目标，布局与颜色沿用所在页面的导航。 */
export function SpaceLinks({ current, onNavigate }: { current: typeof spaces[number]['id']; onNavigate?: () => void }) {
  return <>{spaces.filter(space => space.id !== current).map(({ id, path, label, icon: Icon }) => <Link key={id} to={path} title={`前往${label}`} aria-label={`前往${label}`} onClick={onNavigate}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>)}</>
}
