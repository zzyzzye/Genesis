import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkSupersub from 'remark-supersub'
import remarkFlexibleMarkers from 'remark-flexible-markers'
import { unified, type PluggableList } from 'unified'
import type { Nodes, Root, Text } from 'mdast'

const inlineExtensions = unified().use(remarkSupersub).use(remarkFlexibleMarkers)

function remarkSafeInlineExtensions() {
  return (tree: Root, file: { toString: () => string }) => {
    const source = String(file)
    const literals = new WeakMap<object, Text>()
    function protect(node: Nodes) {
      if (!('children' in node)) return
      const children = node.children as Nodes[]
      children.forEach((child, index) => {
        const raw = source.slice(child.position?.start.offset, child.position?.end.offset)
        // 扩展插件扫描解码后的文本；已转义的文件名和字面标记不能再次被解释。
        if (child.type === 'text' && (child.value.includes('~~') || /\\[~^=]|&#(?:126|94|61);|&#x(?:7e|5e|3d);/i.test(raw))) {
          const literal = { type: 'inlineCode' as const, value: child.value }
          literals.set(literal, child)
          children[index] = literal
        } else protect(child)
      })
    }
    function restore(node: Nodes) {
      if (!('children' in node)) return
      const children = node.children as Nodes[]
      children.forEach((child, index) => {
        const literal = literals.get(child)
        if (literal) children[index] = literal
        else restore(child)
      })
    }
    protect(tree)
    inlineExtensions.runSync(tree)
    restore(tree)
  }
}

// 正文与目录复用同一语法，避免公式中的等号被识别为标题。
export const articleRemarkPlugins: PluggableList = [[remarkGfm, { singleTilde: false }], remarkMath, remarkSafeInlineExtensions]
