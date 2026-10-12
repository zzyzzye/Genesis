import type { Nodes, Root } from 'mdast'
import { toString } from 'mdast-util-to-string'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

export interface ArticleHeading { id: string; level: number; text: string; line: number }

const parser = unified().use(remarkParse).use(remarkGfm)

function collectHeadings(tree: Root, assignIds = false): ArticleHeading[] {
  const headings: ArticleHeading[] = []
  const used = new Set<string>()
  function visit(node: Nodes) {
    if (node.type === 'heading') {
      const text = toString(node)
      const slug = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-') || 'section'
      const base = `section-${slug}`
      let id = base
      let suffix = 2
      while (used.has(id)) id = `${base}-${suffix++}`
      used.add(id)
      headings.push({ id, level: node.depth, text: text || '未命名章节', line: node.position?.start.line ?? 1 })
      if (assignIds) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } }
    }
    if ('children' in node) node.children.forEach(visit)
  }
  visit(tree)
  return headings
}

export function getArticleHeadings(markdown: string): ArticleHeading[] {
  return collectHeadings(parser.runSync(parser.parse(markdown)) as Root)
}

// 正文与目录共用 Markdown AST，正确处理代码围栏、重复标题和行内格式。
export function remarkHeadingIds() {
  return (tree: Root) => { collectHeadings(tree, true) }
}
