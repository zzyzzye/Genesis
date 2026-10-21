import { useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { ApiError, batchArticles, type ArticleBatchAction, type ArticleOperationResult, type BlogPostAdmin, type BlogTag } from '../lib/api'
import { BlogWorkflowDialog } from './BlogWorkflowDialog'
import { TaxonomyPicker } from './TaxonomyPicker'
import './PostManagement.css'
import { articleActions, scheduleInstant } from './postManagement'

export function PostBatchDialog({ token, posts, action, categories, tags, onClose, onComplete, onPendingChange }: {
  token: string
  posts: BlogPostAdmin[]
  action: ArticleBatchAction
  categories: BlogTag[]
  tags: BlogTag[]
  onClose: () => void
  onComplete: (result: ArticleOperationResult) => Promise<void>
  onPendingChange: (pending: boolean) => void
}) {
  const [chosen, setChosen] = useState<string[]>([])
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [dateError, setDateError] = useState('')
  const [operationId] = useState(() => crypto.randomUUID())
  const lock = useRef(false)
  const dateInput = useRef<HTMLInputElement>(null)
  const label = articleActions[action]
  function openCalendar() {
    const field = dateInput.current
    if (!field) return
    field.focus()
    try { field.showPicker?.() } catch { setError('当前浏览器暂时无法打开日历，请直接输入日期和时间。') }
  }
  const description = action === 'permanent' ? '彻底删除所选文章及其评论，无法恢复。已上传附件和共享分类、标签会保留。' : action === 'trash' ? '所选文章将停止公开，定时计划同时取消，可从回收站恢复为草稿。' : action === 'categories' || action === 'tags' ? '替换所选文章的全部分类或标签，其他字段保留。留空会清除原有选择。' : action === 'schedule' ? '仅支持内容完整的草稿；到期后自动公开。服务停机期间到期的文章会在恢复后补发。' : action === 'publish' ? '所选文章将立即公开。已有定时计划将取消。' : action === 'cancel_schedule' ? '取消所选草稿的计划，文章继续保持草稿状态。' : '所选文章将保存为草稿，不再公开；已有定时计划会取消。'

  async function confirm() {
    if (lock.current) return
    const instant = action === 'schedule' ? scheduleInstant(when) : null
    if (action === 'schedule' && !instant) { setDateError('请选择晚于当前时间的有效日期和时间。'); dateInput.current?.focus(); return }
    lock.current = true; setBusy(true); setAttempted(true); setError(''); onPendingChange(true)
    try {
      const result = await batchArticles(token, {
        operation_id: operationId, action, items: posts.map(post => ({ id: post.id, expected_updated_at: post.updated_at })),
        ...(action === 'categories' ? { category_ids: chosen } : action === 'tags' ? { tag_ids: chosen } : {}),
        ...(instant ? { scheduled_at: instant } : {}),
      })
      await onComplete(result)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '结果暂未确认，请重试核对。重复请求不会重复执行。')
    } finally { lock.current = false; setBusy(false); onPendingChange(false) }
  }

  return <BlogWorkflowDialog title={`${label} ${posts.length} 篇文章`} description={description} confirmLabel={busy ? '正在处理…' : attempted ? '重试核对结果' : `确认${label}`} cancelLabel={attempted ? '关闭' : '取消'} busy={busy} error={error} onConfirm={() => { void confirm() }} onCancel={onClose}>
    <ul className="post-batch-targets">{posts.slice(0, 5).map(post => <li key={post.id}>{post.title || '未命名文章'}</li>)}{posts.length > 5 && <li>另有 {posts.length - 5} 篇文章</li>}</ul>
    {(action === 'categories' || action === 'tags') && <TaxonomyPicker kind={action} items={action === 'categories' ? categories : tags} selected={chosen} disabled={busy || attempted} onSelect={item => setChosen(current => item === null ? [] : current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])} />}
    {action === 'schedule' && <div className="post-schedule-field"><label htmlFor="post-schedule-date">发布时间</label><div className="post-schedule-field__input"><input ref={dateInput} id="post-schedule-date" type="datetime-local" value={when} disabled={busy || attempted} aria-invalid={Boolean(dateError)} aria-describedby="post-schedule-help" onChange={event => { setWhen(event.target.value); setDateError(''); setError('') }} />{typeof HTMLInputElement.prototype.showPicker === 'function' && <button type="button" disabled={busy || attempted} aria-label="打开日期选择器" onClick={openCalendar}><CalendarDays size={18} aria-hidden="true" /></button>}</div><small id="post-schedule-help" role={dateError ? 'alert' : undefined}>时区：{Intl.DateTimeFormat().resolvedOptions().timeZone}。{dateError || '按照此时区选择日期和时间。'}</small></div>}
    {attempted && <p>参数已锁定以便安全重试；关闭不会撤销已提交的操作。如提示版本冲突，请关闭后刷新列表并重新选择。</p>}
  </BlogWorkflowDialog>
}
