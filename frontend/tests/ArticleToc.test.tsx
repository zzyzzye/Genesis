import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { ArticleDocument, ArticleToc } from '../src/features/blog/ArticleToc'
import { getArticleHeadings } from '../src/features/blog/articleOutline'

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
