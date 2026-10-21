import type { Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { articleRemarkPlugins } from '../features/blog/articleMarkdownPlugins'

const parser = unified().use(remarkParse).use(articleRemarkPlugins)

/** 富文本无法无损往返的扩展语法使用原生源码编辑器，避免打开时丢失内容。 */
export function requiresMarkdownSource(markdown: string): boolean {
  const tree = parser.runSync(parser.parse(markdown)) as Root
  function unsupported(node: { type: string; data?: { hName?: string }; position?: { start: { offset?: number }; end: { offset?: number } }; children?: unknown[] }): boolean {
    if (['html', 'math', 'inlineMath', 'footnoteDefinition', 'footnoteReference', 'superscript', 'subscript'].includes(node.type) || node.data?.hName === 'mark') return true
    // MDX 把尖括号自动链接解释成 JSX；普通 Markdown 的此类链接必须保留。
    if (node.type === 'link' && markdown.slice(node.position?.start.offset, node.position?.end.offset).startsWith('<')) return true
    return node.children?.some(child => unsupported(child as Parameters<typeof unsupported>[0])) ?? false
  }
  return unsupported(tree)
}
