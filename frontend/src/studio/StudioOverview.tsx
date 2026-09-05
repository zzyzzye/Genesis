import { Link } from 'react-router-dom'

import type { BlogPostAdmin } from '../lib/api'
import { StudioIcon, type StudioIconName } from './StudioIcon'
import type { StudioSection } from './StudioNavigation'

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

export function StudioOverview({
  posts,
  onChange,
  onCreatePost,
  onOpenPost,
}: {
  posts: BlogPostAdmin[]
  onChange: (section: StudioSection) => void
  onCreatePost: () => void
  onOpenPost: (post: BlogPostAdmin) => void
}) {
  const published = posts.filter((post) => post.status === 'published').length
  const drafts = posts.length - published
  const totalMinutes = posts.reduce((total, post) => total + post.read_time_minutes, 0)
  const stats: Array<{ label: string; value: string; icon: StudioIconName; note: string }> = [
    { label: '全部文章', value: String(posts.length), icon: 'articles', note: '内容资产' },
    { label: '已发布', value: String(published), icon: 'eye', note: '公开可见' },
    { label: '待完善草稿', value: String(drafts), icon: 'pages', note: drafts > 0 ? '继续创作' : '暂无积压' },
    { label: '累计阅读时长', value: `${totalMinutes}`, icon: 'spark', note: '分钟内容量' },
  ]
  const quickActions: Array<{ title: string; description: string; icon: StudioIconName; action: () => void }> = [
    { title: '创建文章', description: '开启一篇新的 Markdown 草稿', icon: 'plus', action: onCreatePost },
    { title: '管理文章', description: '查看、编辑与发布现有内容', icon: 'articles', action: () => onChange('posts') },
    { title: '创建页面', description: '搭建独立页面与专题入口', icon: 'pages', action: () => onChange('pages') },
    { title: '附件管理', description: '整理图片、文件与媒体素材', icon: 'attachment', action: () => onChange('attachments') },
    { title: '主题外观', description: '管理站点视觉与展示风格', icon: 'palette', action: () => onChange('themes') },
  ]

  return (
    <section className="studio-overview" aria-labelledby="studio-overview-title">
      <div className="studio-stats" aria-label="博客统计">
        {stats.map((stat) => (
          <article className="studio-stat-card" key={stat.label}>
            <span className="studio-card-icon"><StudioIcon name={stat.icon} /></span>
            <div><p>{stat.label}</p><strong>{stat.value}</strong><small>{stat.note}</small></div>
          </article>
        ))}
      </div>

      <div className="studio-overview-grid">
        <article className="studio-panel studio-quick-panel">
          <header className="studio-panel__header">
            <div><p>QUICK ACCESS</p><h2 id="studio-overview-title">快捷访问</h2></div>
            <span>高频操作集中在这里</span>
          </header>
          <div className="studio-quick-grid">
            {quickActions.map((item) => (
              <button type="button" onClick={item.action} key={item.title}>
                <span className="studio-card-icon"><StudioIcon name={item.icon} /></span>
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
                <StudioIcon className="studio-quick-chevron" name="chevron" />
              </button>
            ))}
            <Link to="/blog">
              <span className="studio-card-icon"><StudioIcon name="eye" /></span>
              <span><strong>查看站点</strong><small>打开访客看到的公开博客</small></span>
              <span className="studio-external-arrow">↗</span>
            </Link>
          </div>
        </article>

        <article className="studio-panel studio-activity-panel">
          <header className="studio-panel__header">
            <div><p>RECENT ACTIVITY</p><h2>最近内容</h2></div>
            <button type="button" onClick={() => onChange('posts')}>查看全部</button>
          </header>
          <div className="studio-activity-list">
            {posts.slice(0, 6).map((post, index) => (
              <button type="button" onClick={() => onOpenPost(post)} key={post.id}>
                <span className={`studio-activity-index studio-activity-index--${(index % 3) + 1}`}>{String(index + 1).padStart(2, '0')}</span>
                <span><strong>{post.title}</strong><small>{post.excerpt || '暂无摘要'}</small></span>
                <span className="studio-activity-meta"><em>{post.status === 'published' ? '已发布' : '草稿'}</em><time>{formatShortDate(post.updated_at)}</time></span>
              </button>
            ))}
            {posts.length === 0 && <div className="studio-empty-activity">还没有内容，从第一篇文章开始。</div>}
          </div>
        </article>
      </div>
    </section>
  )
}
