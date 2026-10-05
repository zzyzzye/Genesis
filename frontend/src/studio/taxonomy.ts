import { createAdminBlogCategory, createAdminBlogTag, type BlogTag } from '../lib/api'

export type TaxonomyKind = 'categories' | 'tags'
export type ArticleTaxonomyActions = {
  onCreateTaxonomy: (kind: TaxonomyKind, name: string) => Promise<BlogTag>
  onSelectTaxonomy: (kind: TaxonomyKind, item: BlogTag | null) => void
}

export function createTaxonomy(token: string, kind: TaxonomyKind, name: string): Promise<BlogTag> {
  // 展示名称与内部标识分离，用户无需维护 URL 格式。
  const data = { name: name.trim(), slug: `${kind === 'tags' ? 'tag' : 'category'}-${crypto.randomUUID()}` }
  return kind === 'tags' ? createAdminBlogTag(token, data) : createAdminBlogCategory(token, data)
}

export function taxonomyError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : fallback
  if (message.includes('HTTP 409')) return '名称已存在，请选择已有项或刷新后重试。'
  if (message.includes('HTTP 401')) return '登录已过期，请重新登录后重试。'
  if (message.includes('HTTP 403')) return '当前账户没有修改权限。'
  return message.includes('HTTP') || message.includes('fetch') ? fallback : message
}
