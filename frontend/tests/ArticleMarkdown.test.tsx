import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { ArticleMarkdown } from '../src/features/blog/ArticleMarkdown'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

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
