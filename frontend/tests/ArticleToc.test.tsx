import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ArticleDocument, ArticleToc } from '../src/features/blog/ArticleToc'
import { getArticleHeadings, getArticleTitleHeading } from '../src/features/blog/articleOutline'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('使用 Markdown 语法提取目录，忽略围栏与转义文本并保留正确源码行号', () => {
  const markdown = '# 开始\n\n~~~md\n# 代码里的标题\n~~~\n\n\\# 普通文字\n\n章节 **二**\n---\n\n###### 最深章节\n'
  expect(getArticleHeadings(markdown).map(({ text, level, line }) => ({ text, level, line }))).toEqual([
    { text: '开始', level: 1, line: 1 }, { text: '章节 二', level: 2, line: 9 }, { text: '最深章节', level: 6, line: 12 },
  ])
})

it('重复标题与后缀碰撞仍生成唯一锚点，正文和目录 ID 一致', () => {
  const markdown = '## 相同\n\n## 相同\n\n## 相同-2\n\n### ~~删除~~ 与 [链接](/blog)'
  const items = getArticleHeadings(markdown)
  expect(new Set(items.map(item => item.id)).size).toBe(4)
  const { container } = render(<MemoryRouter><ArticleDocument content={markdown} /></MemoryRouter>)
  const ids = [...container.querySelectorAll('.article-content :is(h2,h3)')].map(item => item.id)
  expect(ids).toEqual(items.map(item => item.id))
  const nav = screen.getByRole('navigation', { name: '文章目录导航' })
  expect(within(nav).getAllByRole('link').map(link => decodeURIComponent(new URL(link.getAttribute('href')!, 'http://localhost').hash))).toEqual(items.map(item => `#${item.id}`))
})

it('目录可折叠、空态可见，编辑目录回调携带实际标题位置', () => {
  const navigate = vi.fn()
  const items = getArticleHeadings('## 开始\n\n### 深入')
  const view = render(<ArticleToc items={items} onNavigate={navigate} activeId={items[1]?.id} />)
  fireEvent.click(screen.getByRole('button', { name: '深入' }))
  expect(navigate).toHaveBeenCalledWith(items[1], 1)
  expect(screen.getByRole('button', { name: '深入' })).toHaveAttribute('aria-current', 'location')
  const toggle = screen.getByRole('button', { name: /目录 2/ })
  fireEvent.click(toggle)
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  view.rerender(<ArticleToc items={[]} />)
  expect(screen.getByText('暂无章节标题')).toBeVisible()
})

it('阅读页合并开头的重复标题，保留原锚点、正文链接和后续同名章节编号', () => {
  const content = '# **文章标题**\n\n[返回标题](#文章标题)\n\n## 文章标题\n\n## 开始'
  const view = render(<MemoryRouter><ArticleDocument title="文章标题" content={content} intro={<h1>文章标题</h1>} /></MemoryRouter>)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(view.container.querySelector('.article-title-anchor')).toHaveAttribute('id', 'section-文章标题')
  expect(screen.getByRole('link', { name: '返回标题' })).toHaveAttribute('href', '#section-文章标题')
  const nav = screen.getByRole('navigation', { name: '文章目录导航' })
  expect(within(nav).getAllByRole('link')).toHaveLength(2)
  expect(within(nav).getByRole('link', { name: '文章标题' })).toHaveAttribute('href', '/#section-文章标题-2')
  expect(screen.getByRole('heading', { level: 2, name: '文章标题' })).toHaveAttribute('id', 'section-文章标题-2')
})

it('不同标题、非开头标题和二级章节不被合并，编辑预览仍保留一级标题', () => {
  expect(getArticleTitleHeading('# 其他标题', '文章标题')).toBeUndefined()
  expect(getArticleTitleHeading('开场白\n\n# 文章标题', '文章标题')).toBeUndefined()
  expect(getArticleTitleHeading('## 文章标题', '文章标题')).toBeUndefined()
  expect(getArticleTitleHeading('文章标题\n===', '文章标题')?.id).toBe('section-文章标题')
  render(<MemoryRouter><ArticleDocument content="# 文章标题" /></MemoryRouter>)
  expect(screen.getByRole('heading', { level: 1, name: '文章标题' })).toBeInTheDocument()
})

it('阅读目录只展开当前章节的子目录，也支持独立展开和收起其他章节', () => {
  const items = getArticleHeadings('## 开始\n\n### 简介\n\n## 实践\n\n### 步骤\n\n#### 细节\n\n## 总结')
  const renderToc = (activeId: string) => <MemoryRouter><ArticleToc items={items} activeId={activeId} progressive /></MemoryRouter>
  const view = render(renderToc(items[1]!.id))
  expect(screen.getByRole('link', { name: '简介' })).toHaveAttribute('aria-current', 'location')
  expect(screen.queryByRole('link', { name: '步骤' })).not.toBeInTheDocument()
  view.rerender(renderToc(items[4]!.id))
  expect(screen.queryByRole('link', { name: '简介' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '细节' })).toHaveAttribute('aria-current', 'location')
  fireEvent.click(screen.getByRole('button', { name: '展开“开始”子目录' }))
  expect(screen.getByRole('link', { name: '简介' })).toBeVisible()
  const toggle = screen.getByRole('button', { name: '收起“实践”子目录' })
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toHaveAttribute('hidden')
  expect(screen.queryByRole('link', { name: '细节' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: '总结' })).toBeVisible()
})
