import type { ArticleBatchAction } from '../lib/api'

export const articleActions: Record<ArticleBatchAction, string> = {
  publish: '发布', unpublish: '撤回为草稿', categories: '设置分类', tags: '设置标签', schedule: '定时发布', cancel_schedule: '取消定时发布', trash: '移入回收站', restore: '恢复为草稿', permanent: '彻底删除',
}

/** 原生日期控件使用当前浏览器时区，提交时统一转换为带时区的 ISO 时间。 */
export function scheduleInstant(value: string): string | null {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return null
  const pad = (part: number) => String(part).padStart(2, '0')
  const local = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  return local === value ? date.toISOString() : null
}
