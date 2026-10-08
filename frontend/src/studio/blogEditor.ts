import type { BlogPostAdmin, BlogPostStatus, BlogPostWrite, BlogTag } from '../lib/api'

export interface EditorState {
  id: string | null
  slug: string
  title: string
  excerpt: string
  contentMarkdown: string
  coverImageUrl: string
  status: BlogPostStatus
  isFeatured: boolean
  readTimeMinutes: number
  categoryId: string | null
  selectedTagSlugs: string[]
  updatedAt: string | null
}

export function createEmptyEditor(): EditorState {
  return {
    id: null, slug: `post-${crypto.randomUUID()}`, title: '', excerpt: '',
    contentMarkdown: '', coverImageUrl: '', status: 'draft', isFeatured: false,
    readTimeMinutes: 1, categoryId: null, selectedTagSlugs: [], updatedAt: null,
  }
}

export function toEditor(post: BlogPostAdmin): EditorState {
  return {
    id: post.id, slug: post.slug, title: post.title, excerpt: post.excerpt,
    contentMarkdown: post.content_markdown, coverImageUrl: post.cover_image_url ?? '',
    status: post.status, isFeatured: post.is_featured, readTimeMinutes: post.read_time_minutes,
    categoryId: post.category_id ?? post.category?.id ?? null,
    selectedTagSlugs: post.tags.map((tag) => tag.slug), updatedAt: post.updated_at,
  }
}

function plainText(markdown: string): string {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/```[^\n]*\n?|[*_~`|]/g, '').replace(/\s+/g, ' ').trim()
}

export function articleStats(markdown: string) {
  const text = plainText(markdown)
  const chinese = text.match(/[\p{Script=Han}]/gu)?.length ?? 0
  const words = text.replace(/[\p{Script=Han}]/gu, ' ').match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  return { count: chinese + words, minutes: Math.min(120, Math.max(1, Math.ceil(chinese / 400 + words / 200))) }
}

export function toPayload(editor: EditorState, tags: BlogTag[], status = editor.status): BlogPostWrite {
  const title = editor.title.trim()
  const content = editor.contentMarkdown.trim()
  if (status === 'published' && (!title || !plainText(content))) throw new Error('发布前请填写标题和正文。')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(editor.slug)) throw new Error('文章地址只能包含小写字母、数字和连接号，请在设置中修改。')
  if (title.length > 200) throw new Error('文章标题最多 200 个字符。')
  if (editor.excerpt.trim().length > 500) throw new Error('摘要最多 500 个字符，请在设置中缩短。')
  return {
    slug: editor.slug, title: title || '未命名文章',
    excerpt: editor.excerpt.trim() || plainText(content).slice(0, 160),
    content_markdown: content, cover_image_url: editor.coverImageUrl.trim() || null,
    category_id: editor.categoryId, status, is_featured: editor.isFeatured,
    read_time_minutes: articleStats(content).minutes, expected_updated_at: editor.updatedAt,
    tags: editor.selectedTagSlugs.map((slug) => {
      const tag = tags.find((item) => item.slug === slug)
      if (!tag) throw new Error('所选标签已被移除，请在设置中重新选择。')
      return { name: tag.name, slug: tag.slug }
    }),
  }
}

export type BlogDraft = { editor: EditorState; savedAt: number }
const draftLifetime = 7 * 24 * 60 * 60 * 1000
export const blogDraftKey = (userId: string, postId: string | null) => `genesis-blog-draft:${userId}:${postId ?? 'new'}`

export function readBlogDraft(userId: string, postId: string | null): BlogDraft | null {
  try {
    const raw = sessionStorage.getItem(blogDraftKey(userId, postId))
    if (!raw) return null
    const draft = JSON.parse(raw) as Partial<BlogDraft>
    const editor = draft.editor
    if (!editor || typeof draft.savedAt !== 'number' || !Number.isFinite(draft.savedAt)
      || Date.now() - draft.savedAt > draftLifetime || draft.savedAt > Date.now()
      || editor.id !== postId || !['draft', 'published'].includes(editor.status)
      || !['slug', 'title', 'excerpt', 'contentMarkdown', 'coverImageUrl'].every((field) => typeof editor[field as keyof EditorState] === 'string')
      || typeof editor.isFeatured !== 'boolean' || typeof editor.readTimeMinutes !== 'number'
      || !(editor.categoryId === null || typeof editor.categoryId === 'string')
      || !(editor.updatedAt === null || typeof editor.updatedAt === 'string')
      || !Array.isArray(editor.selectedTagSlugs) || !editor.selectedTagSlugs.every((slug) => typeof slug === 'string')) return null
    return { editor, savedAt: draft.savedAt }
  } catch { return null }
}

export function writeBlogDraft(userId: string, editor: EditorState): boolean {
  try {
    sessionStorage.setItem(blogDraftKey(userId, editor.id), JSON.stringify({ editor, savedAt: Date.now() }))
    return true
  } catch { return false }
}

export function clearBlogDraft(userId: string, postId: string | null) {
  try { sessionStorage.removeItem(blogDraftKey(userId, postId)) } catch { /* 存储被浏览器禁用时，仍允许继续编辑。 */ }
}
