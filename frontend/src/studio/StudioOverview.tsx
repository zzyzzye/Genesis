import './StudioOverview.css'

import type { BlogPostAdmin } from '../lib/api'
import { StudioIcon, type StudioIconName } from './StudioIcon'
import type { StudioSection } from './StudioNavigationModel'

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

export function StudioOverview({
  posts,
  onChange,
  onOpenPost,
}: {
  posts: BlogPostAdmin[]
  onChange: (section: StudioSection) => void
  onOpenPost: (post: BlogPostAdmin) => void
}) {
  const published = posts.filter((post) => post.status === 'published').length
  const drafts = posts.length - published
  const totalMinutes = posts.reduce((total, post) => total + post.read_time_minutes, 0)
  const stats: Array<{ label: string; value: string; note: string }> = [
    { label: '全部文章', value: String(posts.length), note: '' },
    { label: '已发布', value: String(published), note: '' },
    { label: '草稿', value: String(drafts), note: '' },
    { label: '阅读总时长', value: `${totalMinutes}`, note: '分钟' },
  ]
  const quickActions: Array<{ title: string; icon: StudioIconName; action: () => void }> = [
    { title: '管理文章', icon: 'articles', action: () => onChange('posts') },
    { title: '整理分类', icon: 'folder', action: () => onChange('categories') },
    { title: '管理标签', icon: 'tag', action: () => onChange('tags') },
  ]
  const activityItems = [...posts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5).map((post) => ({
      id: post.id,
      title: post.title,
      description: post.excerpt,
      label: post.status === 'published' ? '已发布' : '草稿',
      date: formatShortDate(post.updated_at),
      post,
    }))

  return (
    <section className="studio-overview" aria-label="内容概览">
      <div className="studio-stats" aria-label="博客统计">
        {stats.map((stat) => (
          <article className="studio-stat-card" key={stat.label}>
            <p>{stat.label}</p><div className="studio-stat-value"><strong>{stat.value}</strong>{stat.note && <small>{stat.note}</small>}</div>
          </article>
        ))}
      </div>

      <div className="studio-overview-grid">
        <article className="studio-panel studio-quick-panel">
          <header className="studio-panel__header">
            <h2 id="studio-overview-title">快捷访问</h2>
          </header>
          <div className="studio-quick-grid">
            {quickActions.map((item) => (
              <button type="button" onClick={item.action} key={item.title}>
                <span className="studio-card-icon"><StudioIcon name={item.icon} /></span>
                <strong>{item.title}</strong>
                <StudioIcon className="studio-quick-chevron" name="chevron" />
              </button>
            ))}
          </div>
        </article>

        <article className="studio-panel studio-activity-panel">
          <header className="studio-panel__header">
            <h2>最近内容</h2>
            {activityItems.length > 0 && <button type="button" onClick={() => onChange('posts')}>查看全部</button>}
          </header>
          <div className="studio-activity-list">
            {activityItems.map((item) => (
              <button
                type="button"
                onClick={() => onOpenPost(item.post)}
                key={item.id}
              >
                <StudioIcon name="articles" />
                <span><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}</span>
                <span className="studio-activity-meta"><em>{item.label}</em><time dateTime={item.post.updated_at}>{item.date}</time></span>
              </button>
            ))}
            {activityItems.length === 0 && <div className="studio-empty-activity"><StudioIcon name="articles" /><strong>还没有文章</strong><p>点击右上角「创建文章」，开始第一篇草稿。</p></div>}
          </div>
        </article>
      </div>
    </section>
  )
}
