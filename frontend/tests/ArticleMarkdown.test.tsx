import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ArticleMarkdown } from '../src/features/blog/ArticleMarkdown'
import { getArticleHeadings } from '../src/features/blog/articleOutline'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('转义的上下标与高亮保持字面内容，不损伤文件名', () => {
  const view = render(<ArticleMarkdown>{'\\~\\~ \\^原样\\^ \\=\\=原样\\=\\='}</ArticleMarkdown>)
  expect(view.container).toHaveTextContent('~~ ^原样^ ==原样==')
  expect(view.container.querySelector('sub, sup, mark')).toBeNull()
})

it('支持安全 HTML、上下标与高亮，代码中的标签保持字面内容', () => {
  const view = render(<ArticleMarkdown>{'<details>\n<summary>展开说明</summary>\n\n**正文**\n\n</details>\n\n<kbd>Ctrl</kbd> <abbr title="说明">HTML</abbr> <center>居中</center>\n\nH~2~O 2^10^ ==重点== `==原样==` ~~过时~~\n\n<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">危险</a><iframe src="https://example.com"></iframe>'}</ArticleMarkdown>)
  expect(view.container.querySelector('details summary')).toHaveTextContent('展开说明')
  expect(view.container.querySelector('details strong')).toHaveTextContent('正文')
  expect(view.container.querySelector('kbd')).toHaveTextContent('Ctrl')
  expect(view.container.querySelector('abbr')).toHaveAttribute('title', '说明')
  expect(view.container.querySelector('sub')).toHaveTextContent('2')
  expect(view.container.querySelector('sup')).toHaveTextContent('10')
  expect(view.container.querySelector('mark')).toHaveTextContent('重点')
  expect(view.container.querySelector('code')).toHaveTextContent('==原样==')
  expect(view.container.querySelector('del')).toHaveTextContent('过时')
  expect(view.container.querySelector('script, iframe, [onerror]')).toBeNull()
  expect(screen.getByText('危险')).not.toHaveAttribute('href', expect.stringContaining('javascript:'))
})

it('渲染行内与块级数学，目录不包含公式伪标题，手写锚点指向实际章节', () => {
  const source = '[跳到代码](#代码)\n\n## 五、代码\n\n$E=mc^2$\n\n$$\n\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}\n=\n1\n$$\n\n脚注[^1]\n\n[^1]: 补充说明'
  const view = render(<ArticleMarkdown>{source}</ArticleMarkdown>)
  expect(view.container.querySelectorAll('.katex')).toHaveLength(2)
  expect(view.container.querySelector('.katex-error')).toBeNull()
  expect(getArticleHeadings(source).map(heading => heading.text)).toEqual(['五、代码'])
  expect(screen.getByRole('link', { name: '跳到代码' })).toHaveAttribute('href', '#section-五代码')
  expect(screen.getByRole('heading', { name: '五、代码' })).toHaveAttribute('id', 'section-五代码')
  expect(screen.getByRole('heading', { name: '脚注' })).toBeInTheDocument()
})

it('正文附件以可下载链接显示，普通文章链接保持原语义', () => {
  render(<ArticleMarkdown>{'[资料.zip](/api/v1/blog/attachments/12345678-1234-1234-1234-123456789abc/file)\n\n[普通链接](/blog)'}</ArticleMarkdown>)
  expect(screen.getByRole('link', { name: '资料.zip' })).toHaveAttribute('download', '')
  expect(screen.getByRole('link', { name: '资料.zip' })).toHaveClass('article-attachment-link')
  expect(screen.getByRole('link', { name: '普通链接' })).not.toHaveAttribute('download')
})

it('按声明语言高亮，显示行号和语言，行内代码保持原样', async () => {
  const view = render(<ArticleMarkdown>{'行内 `print`\n\n```python\nimport sys\n\nprint("你好")\n```\n\n```bash\necho "hello"\n```'}</ArticleMarkdown>)
  expect(screen.getByText('Python')).toBeInTheDocument()
  expect(screen.getByText('Shell')).toBeInTheDocument()
  expect(screen.getByText('3 行')).toBeInTheDocument()
  expect(view.container.querySelectorAll('.article-code__number')).toHaveLength(4)
  await waitFor(() => expect(view.container.querySelector('.tok-keyword')).toHaveTextContent('import'))
  expect(view.container.querySelector('p code')).toHaveTextContent('print')
})

it('复制原始代码，失败后可重试，不混入行号', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  render(<ArticleMarkdown>{'```python\ndef run():\n    return 1\n```'}</ArticleMarkdown>)
  fireEvent.click(screen.getByRole('button', { name: '复制 Python 代码' }))
  expect(await screen.findByRole('status')).toHaveTextContent('复制失败')
  fireEvent.click(screen.getByRole('button', { name: '复制 Python 代码' }))
  expect(await screen.findByText('已复制')).toBeInTheDocument()
  expect(writeText).toHaveBeenLastCalledWith('def run():\n    return 1\n')
})

it('未知语言和空代码保留可读内容并安全显示标签', () => {
  const view = render(<ArticleMarkdown>{'```unknown\n<script>alert(1)</script>\n```\n\n```\n```'}</ArticleMarkdown>)
  expect(screen.getByText('unknown')).toBeInTheDocument()
  expect(screen.getByText('纯文本')).toBeInTheDocument()
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument()
  expect(view.container.querySelector('script')).toBeNull()
  expect(screen.getAllByRole('button')).toHaveLength(2)
})

it('超过 20 行默认折叠，展开收起后仍复制完整代码，边界行数不折叠', async () => {
  const source = Array.from({ length: 22 }, (_, index) => `print(${index + 1})`).join('\n')
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const view = render(<ArticleMarkdown>{`\`\`\`python\n${source}\n\`\`\``}</ArticleMarkdown>)
  expect(view.container.querySelectorAll('.article-code__line')).toHaveLength(20)
  const toggle = screen.getByRole('button', { name: '展开剩余 2 行' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(view.container.querySelectorAll('.article-code__line')).toHaveLength(22)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('button', { name: '收起代码' }))
  expect(view.container.querySelectorAll('.article-code__line')).toHaveLength(20)
  fireEvent.click(screen.getByRole('button', { name: '复制 Python 代码' }))
  await screen.findByText('已复制')
  expect(writeText).toHaveBeenCalledWith(`${source}\n`)
  await act(async () => {
    view.rerender(<ArticleMarkdown>{`\`\`\`python\n${source.split('\n').slice(0, 20).join('\n')}\n\`\`\``}</ArticleMarkdown>)
    await Promise.resolve()
  })
  expect(screen.queryByRole('button', { name: /展开剩余|收起代码/ })).not.toBeInTheDocument()
})
