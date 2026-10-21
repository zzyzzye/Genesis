import { CalendarClock, CalendarX2, Check, FilePenLine, FilePlus2, Send, Trash2 } from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { AiActionProposal } from '../../../lib/api'

const actionLabels = {
  create_draft: { name: '创建新草稿', button: '确认创建', done: '草稿已创建', hint: '保存为一篇新的草稿', icon: FilePlus2 },
  create_and_publish: { name: '创建并发布文章', button: '确认发布', done: '文章已发布', hint: '一次确认后创建文章并公开发布', icon: Send },
  update_post: { name: '更新文章', button: '确认更新', done: '文章已更新', hint: '将修改保存到目标文章', icon: FilePenLine },
  publish_post: { name: '发布文章', button: '确认发布', done: '文章已发布', hint: '通过校验后公开发布', icon: Send },
  delete_post: { name: '移入回收站', button: '确认移入回收站', done: '文章已移入回收站', hint: '文章将停止公开，可在文章回收站中恢复为草稿', icon: Trash2 },
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

function proposalLabels(action: AiActionProposal, changes: Record<string, unknown>) {
  if (action.action === 'create_draft' || action.action === 'update_post') {
    if (typeof changes.scheduled_at === 'string') return { name: action.action === 'create_draft' ? '创建并定时发布' : action.payload.target_status === 'published' ? '撤回并定时发布' : '安排定时发布', button: '确认定时发布', done: '发布计划已保存', hint: action.payload.target_status === 'published' ? '先停止当前公开展示，保存为草稿，再在计划时间重新发布' : '文章保留为草稿，到达计划时间后自动公开发布', icon: CalendarClock }
    if (action.action === 'update_post') {
      if (changes.status === 'published') return { ...actionLabels.publish_post, name: '更新并发布文章', hint: '保存本次修改并立即公开发布' }
      if (changes.status === 'draft' && action.payload.target_status === 'published') return { ...actionLabels.update_post, name: '撤回文章', button: '确认撤回', done: '文章已撤回', hint: '停止公开并保存为草稿' }
      if (changes.scheduled_at === null) return { name: '取消定时发布', button: '确认取消计划', done: '发布计划已取消', hint: '取消原定发布计划，其他设置按本次修改保存', icon: CalendarX2 }
    }
  }
  return actionLabels[action.action] ?? { name: '确认操作', button: '确认执行', done: '操作已完成', hint: action.summary, icon: FilePenLine }
}

function ProposalMetadata({ action, changes }: { action: AiActionProposal; changes: Record<string, unknown> }) {
  const hasCategories = 'category_ids' in changes || 'category_id' in changes
  const categories = Array.isArray(action.payload.category_names) ? action.payload.category_names.filter((name): name is string => typeof name === 'string') : null
  const tags = Array.isArray(changes.tags) ? changes.tags.flatMap((tag: unknown) => typeof tag === 'object' && tag !== null && 'name' in tag && typeof tag.name === 'string' ? [tag.name] : []) : null
  const scheduled = typeof changes.scheduled_at === 'string' ? new Date(changes.scheduled_at) : null
  const validTime = scheduled && Number.isFinite(scheduled.getTime())
  return <>
    {hasCategories && categories && <p className="studio-assistant__action-excerpt">分类：{categories.join('、') || '暂不分类'}</p>}
    {tags && <p className="studio-assistant__action-excerpt">标签：{tags.join('、') || '无标签'}</p>}
    {validTime && <p className="studio-assistant__action-excerpt">计划发布：<time dateTime={changes.scheduled_at as string}>{scheduled.toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}</time></p>}
    {changes.scheduled_at === null && action.action === 'update_post' && <p className="studio-assistant__action-excerpt">发布计划：取消原计划</p>}
  </>
}

export function BlogActionProposal({ action, executed, busy, disabled, targetPost, onConfirm }: {
  action: AiActionProposal; executed: boolean; busy: boolean; disabled: boolean; targetPost?: { id: string | null; title: string } | null; onConfirm: () => void
}) {
  const historicalDelete = action.action === 'delete_post' && executed && action.execution_result?.status !== 'trashed'
  const changes = proposalChanges(action)
  const labels = historicalDelete ? { ...actionLabels.delete_post, done: action.execution_result?.status === 'deleted' ? '文章已彻底删除' : '删除操作已完成', hint: action.execution_result?.status === 'deleted' ? '历史永久删除操作，无法恢复' : '请到文章回收站查看可恢复的文章' } : proposalLabels(action, changes)
  const Icon = executed ? Check : labels.icon
  const targetTitle = typeof action.payload.target_title === 'string' ? action.payload.target_title : targetPost?.id && targetPost.id === action.payload.post_id ? targetPost.title : ''
  const title = typeof changes.title === 'string' ? changes.title : typeof action.payload.title === 'string' ? action.payload.title : targetTitle || (typeof action.payload.post_id === 'string' ? `目标文章 ${action.payload.post_id.slice(0, 8)}` : '')
  const excerpt = typeof changes.excerpt === 'string' ? changes.excerpt : ''
  const content = typeof changes.content_markdown === 'string' ? changes.content_markdown : ''
  const fields = action.action === 'update_post' ? [...new Set(Object.keys(changes).map((field) => ({ title: '标题', excerpt: '摘要', content_markdown: '正文', slug: '文章路径', status: '发布状态', tags: '标签', category_id: '分类', category_ids: '分类', cover_image_url: '封面', is_featured: '精选', read_time_minutes: '阅读时长', published_at: '发布时间', scheduled_at: '发布计划' }[field])).filter(Boolean))] : []

  return <section className={`studio-assistant__action-card${executed ? ' is-executed' : ''}`} aria-label={labels.name}>
    <div className="studio-assistant__action-heading"><Icon size={16} aria-hidden="true" /><span>{executed ? labels.done : labels.name}</span><span className="studio-assistant__action-state">{executed ? '执行结果' : '操作确认'}</span></div>
    {title && <h4 className="studio-assistant__action-title">{title}</h4>}
    <p className="studio-assistant__action-hint">{labels.hint}{fields.length ? ` · 修改${fields.join('、')}` : ''}</p>
    <ProposalMetadata action={action} changes={changes} />
    {excerpt && <p className="studio-assistant__action-excerpt">{excerpt}</p>}
    {content && <details className="studio-assistant__action-details"><summary>查看正文预览<span>{content.replace(/\s/g, '').length.toLocaleString('zh-CN')} 字符</span></summary><div className="studio-assistant__action-preview"><Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown></div></details>}
    <div className="studio-assistant__action-footer"><span>{executed ? '已完成' : busy ? '正在执行…' : '尚未执行'}</span>
      <button type="button" disabled={disabled || busy || executed} onClick={onConfirm}>{executed ? '已完成' : busy ? '执行中…' : labels.button}</button>
    </div>
  </section>
}
