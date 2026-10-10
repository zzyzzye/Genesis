import { Check, FilePenLine, FilePlus2, Send, Trash2 } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { AiActionProposal } from '../../../lib/api'

const actionLabels = {
  create_draft: { name: '创建新草稿', button: '确认创建', done: '草稿已创建', hint: '保存为一篇新的草稿', icon: FilePlus2 },
  update_post: { name: '更新文章', button: '确认更新', done: '文章已更新', hint: '将修改保存到目标文章', icon: FilePenLine },
  publish_post: { name: '发布文章', button: '确认发布', done: '文章已发布', hint: '通过校验后公开发布', icon: Send },
  delete_post: { name: '删除文章', button: '确认删除', done: '文章已删除', hint: '删除目标文章，此操作无法撤销', icon: Trash2 },
}

function proposalChanges(action: AiActionProposal): Record<string, unknown> {
  if (action.action !== 'update_post') return action.payload
  const changes = action.payload.changes
  if (typeof changes === 'object' && changes !== null && !Array.isArray(changes)) return changes as Record<string, unknown>
  if (typeof changes === 'string') {
    try {
      const parsed: unknown = JSON.parse(changes)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // 无法解析的提议仍交给确认接口校验，不猜测修改内容。
    }
  }
  return {}
}

export function BlogActionProposal({ action, executed, busy, disabled, targetPost, onConfirm }: {
  action: AiActionProposal; executed: boolean; busy: boolean; disabled: boolean; targetPost?: { id: string | null; title: string } | null; onConfirm: () => void
}) {
  const labels = actionLabels[action.action] ?? { name: '确认操作', button: '确认执行', done: '操作已完成', hint: action.summary, icon: FilePenLine }
  const Icon = executed ? Check : labels.icon
  const changes = proposalChanges(action)
  const targetTitle = targetPost?.id && targetPost.id === action.payload.post_id ? targetPost.title : ''
  const title = typeof changes.title === 'string' ? changes.title : typeof action.payload.title === 'string' ? action.payload.title : targetTitle || (typeof action.payload.post_id === 'string' ? `目标文章 ${action.payload.post_id.slice(0, 8)}` : '')
  const excerpt = typeof changes.excerpt === 'string' ? changes.excerpt : ''
  const content = typeof changes.content_markdown === 'string' ? changes.content_markdown : ''
  const fields = action.action === 'update_post' ? Object.keys(changes).map((field) => ({ title: '标题', excerpt: '摘要', content_markdown: '正文', slug: '文章路径', status: '发布状态', tags: '标签', category_id: '分类', cover_image_url: '封面', is_featured: '精选', read_time_minutes: '阅读时长', published_at: '发布时间' }[field])).filter(Boolean) : []

  return <section className={`studio-assistant__action-card${executed ? ' is-executed' : ''}`} aria-label={labels.name}>
    <div className="studio-assistant__action-heading"><Icon size={16} aria-hidden="true" /><span>{executed ? labels.done : labels.name}</span></div>
    {title && <h4 className="studio-assistant__action-title">{title}</h4>}
    <p className="studio-assistant__action-hint">{labels.hint}{fields.length ? ` · 修改${fields.join('、')}` : ''}</p>
    {excerpt && <p className="studio-assistant__action-excerpt">{excerpt}</p>}
    {content && <details className="studio-assistant__action-details"><summary>查看正文预览<span>{content.replace(/\s/g, '').length.toLocaleString('zh-CN')} 字符</span></summary><div className="studio-assistant__action-preview"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div></details>}
    <div className="studio-assistant__action-footer"><span>{executed ? '已完成' : busy ? '正在执行…' : '尚未执行'}</span>
      <button type="button" disabled={disabled || busy || executed} onClick={onConfirm}>{executed ? '已完成' : busy ? '执行中…' : labels.button}</button>
    </div>
  </section>
}
