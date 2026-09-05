import type { StudioIconName } from './StudioIcon'

export type StudioSection = 'overview' | 'posts' | 'pages' | 'comments' | 'attachments' | 'links' | 'themes' | 'menus' | 'users' | 'settings'

export type NavigationItem = { id: StudioSection; label: string; icon: StudioIconName; description: string }
export type NavigationGroup = { id: 'content' | 'appearance' | 'system'; label: string; icon: StudioIconName; items: NavigationItem[] }

export const navigationGroups: NavigationGroup[] = [
  {
    id: 'content',
    label: '内容管理',
    icon: 'articles',
    items: [
      { id: 'posts', label: '文章', icon: 'articles', description: '编辑、整理与发布文章' },
      { id: 'pages', label: '页面', icon: 'pages', description: '管理站点固定页面' },
      { id: 'comments', label: '评论', icon: 'comments', description: '查看读者反馈与讨论' },
      { id: 'attachments', label: '附件', icon: 'attachment', description: '整理图片与媒体素材' },
      { id: 'links', label: '链接', icon: 'link', description: '维护站点重要连接' },
    ],
  },
  {
    id: 'appearance',
    label: '外观设计',
    icon: 'palette',
    items: [
      { id: 'themes', label: '主题', icon: 'palette', description: '管理站点视觉风格' },
      { id: 'menus', label: '菜单', icon: 'menu', description: '组织站点导航结构' },
    ],
  },
  {
    id: 'system',
    label: '系统管理',
    icon: 'settings',
    items: [
      { id: 'users', label: '用户', icon: 'user', description: '管理作者资料与权限' },
      { id: 'settings', label: '设置', icon: 'settings', description: '配置博客系统信息' },
    ],
  },
]

export function getNavigationGroup(section: StudioSection) {
  return navigationGroups.find((group) => group.items.some((item) => item.id === section))
}
