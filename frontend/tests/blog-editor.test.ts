import { afterEach, describe, expect, it, vi } from 'vitest'
import { articleStats, blogDraftKey, clearBlogDraft, createEmptyEditor, readBlogDraft, toPayload, writeBlogDraft } from '../src/studio/blogEditor'

describe('博客草稿与发布数据', () => {
  afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

  it('空白草稿可以保存，公开发布要求真实标题和正文', () => {
    const editor = createEmptyEditor()
    expect(editor.contentMarkdown).toBe('')
    expect(toPayload(editor, [])).toMatchObject({ status: 'draft', title: '未命名文章', content_markdown: '' })
    expect(() => toPayload(editor, [], 'published')).toThrow('标题和正文')
    expect(() => toPayload({ ...editor, title: '只有图片', contentMarkdown: '![图片](https://example.com/image.png)' }, [], 'published')).toThrow('标题和正文')
  })

  it('保留发布状态、版本与分类标签，并补充摘要和阅读时间', () => {
    const editor = { ...createEmptyEditor(), title: '写作闭环', contentMarkdown: '# 标题\n\n正文内容', status: 'published' as const, updatedAt: '2026-10-08T00:00:00Z', categoryId: 'category', selectedTagSlugs: ['writing'] }
    const payload = toPayload(editor, [{ id: 'tag', name: '写作', slug: 'writing' }])
    expect(payload).toMatchObject({ status: 'published', excerpt: '标题 正文内容', expected_updated_at: editor.updatedAt, category_id: 'category', tags: [{ name: '写作', slug: 'writing' }] })
    expect(articleStats('中'.repeat(401)).minutes).toBe(2)
    expect(articleStats('word '.repeat(201)).minutes).toBe(2)
    expect(() => toPayload(editor, [])).toThrow('所选标签已被移除')
  })

  it('暂存按用户、文章隔离，清除只影响当前文章', () => {
    const editor = { ...createEmptyEditor(), title: '当前标签页', contentMarkdown: '尚未保存' }
    expect(writeBlogDraft('author-1', editor)).toBe(true)
    expect(readBlogDraft('author-1', null)?.editor).toEqual(editor)
    expect(readBlogDraft('author-2', null)).toBeNull()
    expect(readBlogDraft('author-1', 'other')).toBeNull()
    clearBlogDraft('author-1', null)
    expect(readBlogDraft('author-1', null)).toBeNull()
  })

  it('损坏、过期和存储不可用时不恢复内容或阻止编辑', () => {
    const key = blogDraftKey('author', null)
    sessionStorage.setItem(key, '{broken')
    expect(readBlogDraft('author', null)).toBeNull()
    sessionStorage.setItem(key, JSON.stringify({ editor: createEmptyEditor(), savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }))
    expect(readBlogDraft('author', null)).toBeNull()
    sessionStorage.setItem(key, JSON.stringify({ editor: { ...createEmptyEditor(), selectedTagSlugs: [null] }, savedAt: Date.now() }))
    expect(readBlogDraft('author', null)).toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage denied') })
    expect(writeBlogDraft('author', createEmptyEditor())).toBe(false)
  })
})
