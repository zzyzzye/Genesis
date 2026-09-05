import type { SVGProps } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bot,
  ChevronRight,
  Eye,
  File,
  FileText,
  Gauge,
  Link2,
  List,
  LogOut,
  MessageSquare,
  Palette,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Sparkles,
  UserRound,
  Video,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'

export type StudioIconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up-right'
  | 'articles'
  | 'attachment'
  | 'assistant'
  | 'bell'
  | 'chevron'
  | 'close'
  | 'comments'
  | 'dashboard'
  | 'eye'
  | 'link'
  | 'logout'
  | 'media'
  | 'menu'
  | 'pages'
  | 'palette'
  | 'plus'
  | 'search'
  | 'send'
  | 'settings'
  | 'spark'
  | 'tools'
  | 'user'

const icons: Record<StudioIconName, LucideIcon> = {
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up-right': ArrowUpRight,
  articles: FileText,
  attachment: Paperclip,
  assistant: Bot,
  bell: Bell,
  chevron: ChevronRight,
  close: X,
  comments: MessageSquare,
  dashboard: Gauge,
  eye: Eye,
  link: Link2,
  logout: LogOut,
  media: Video,
  menu: List,
  pages: File,
  palette: Palette,
  plus: Plus,
  search: Search,
  send: Send,
  settings: Settings,
  spark: Sparkles,
  tools: Wrench,
  user: UserRound,
}

export function StudioIcon({ name, ...props }: { name: StudioIconName } & SVGProps<SVGSVGElement>) {
  const Icon = icons[name]

  return <Icon aria-hidden="true" focusable="false" strokeWidth={1.8} {...props} />
}
