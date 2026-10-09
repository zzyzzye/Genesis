import './StudioOverview.css'

import { Link } from 'react-router-dom'

import type { BlogPostAdmin } from '../lib/api'
import { StudioIcon, type StudioIconName } from './StudioIcon'
import type { StudioSection } from './StudioNavigationModel'

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
    { title: '整理分类', description: '为文章建立清楚的内容分区', icon: 'folder', action: () => onChange('categories') },
    { title: '管理标签', description: '用关键词串联相关的想法', icon: 'tag', action: () => onChange('tags') },
  ]
  const activityItems = [...posts].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5).map((post) => ({
      id: post.id,
      title: post.title,
      description: post.excerpt || '暂无摘要',
      label: post.status === 'published' ? '已发布' : '草稿',
      date: formatShortDate(post.updated_at),
      post,
    }))

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
            {activityItems.map((item) => (
              <button
                type="button"
                onClick={() => onOpenPost(item.post)}
                key={item.id}
              >
                <StudioIcon name="articles" />
                <span><strong>{item.title}</strong><small>{item.description}</small></span>
                <span className="studio-activity-meta"><em>{item.label}</em><time>{item.date}</time></span>
              </button>
            ))}
            {activityItems.length === 0 && <div className="studio-empty-activity"><StudioIcon name="articles" /><strong>还没有文章</strong><p>从一篇草稿开始，记录值得留下的想法。</p><button type="button" onClick={onCreatePost}>创建第一篇文章 <span aria-hidden="true">↗</span></button></div>}
          </div>
        </article>
      </div>
    </section>
  )
}
