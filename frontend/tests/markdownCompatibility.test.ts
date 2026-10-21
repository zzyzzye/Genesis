import { expect, it } from 'vitest'
import { requiresMarkdownSource } from '../src/studio/markdownCompatibility'

it('普通文章保持富文本，代码里的扩展语法不触发回退', () => {
  expect(requiresMarkdownSource('# 标题\n\n**正文** [链接](https://example.com)\n\n- [x] 完成\n\n```html\n<details>\n```\n\n`$x$ ==高亮==`')).toBe(false)
})

it.each(['<https://example.com>', '<details>\n<summary>说明</summary>\n\n正文\n\n</details>', '$x^2$', '$$\nx = 1\n$$', '脚注[^1]\n\n[^1]: 注释', 'H~2~O', '2^10^', '==重点=='])('扩展语法采用源码编辑以保留原文：%s', source => {
  expect(requiresMarkdownSource(source)).toBe(true)
})
