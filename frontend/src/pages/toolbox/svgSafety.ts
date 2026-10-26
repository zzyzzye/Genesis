import DOMPurify from 'dompurify'

/** 预览、复制与下载统一使用同一份静态且不访问外部资源的 SVG。 */
export function safeSvg(source: string): string {
  const trimmed = source.trim().replace(/^```(?:svg|xml)?\s*/i, '').replace(/\s*```$/, '').trim()
  if (!trimmed || /<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(trimmed)) throw new Error('SVG 包含不支持的文档声明，请重新生成。')
  const parser = new DOMParser()
  const original = parser.parseFromString(trimmed, 'image/svg+xml')
  if (original.querySelector('parsererror') || original.documentElement.localName !== 'svg' || original.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('SVG 未完整生成或格式无效，已保留源码，请重新生成。')
  const clean = DOMPurify.sanitize(trimmed, {
    USE_PROFILES: { svg:true, svgFilters:true },
    FORBID_TAGS: ['script','foreignObject','style','image','a','animate','animateMotion','animateTransform','set','feImage'],
    FORBID_ATTR: ['style'],
  })
  const document = parser.parseFromString(clean, 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') throw new Error('无法安全预览此 SVG，请重新生成。')
  for (const node of document.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      const value = attribute.value.trim()
      const isHref = attribute.localName.toLowerCase() === 'href'
      if (attribute.localName.toLowerCase().startsWith('on') || isHref && !/^#[\w.-]+$/.test(value)
        || /url\s*\(/i.test(value) && !/^url\(\s*['"]?#[\w.-]+['"]?\s*\)$/i.test(value)) node.removeAttributeNode(attribute)
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement)
}
