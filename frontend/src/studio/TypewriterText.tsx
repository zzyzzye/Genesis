import { memo, useEffect, useRef } from 'react'

/** 流式阶段只追加文本节点，避免逐字解析 Markdown 或重绘整个会话。 */
export const TypewriterText = memo(function TypewriterText({ content, onProgress }: {
  content: string
  onProgress: () => void
}) {
  const element = useRef<HTMLSpanElement>(null)
  const target = useRef('')
  const progress = useRef(onProgress)
  const wake = useRef<(() => void) | null>(null)

  useEffect(() => {
    target.current = content
    progress.current = onProgress
    wake.current?.()
  }, [content, onProgress])

  useEffect(() => {
    const host = element.current
    if (!host) return
    const text = document.createTextNode('')
    host.replaceChildren(text)
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame: number | null = null
    let lastPaint = 0
    let offset = 0
    let previous = ''

    function paint(now: number) {
      frame = null
      const next = target.current
      if (next !== previous && !next.startsWith(previous)) {
        text.data = ''
        offset = 0
      }
      previous = next
      const elapsed = lastPaint ? Math.min(now - lastPaint, 100) : 32
      if (elapsed < 32 && offset < next.length) {
        frame = requestAnimationFrame(paint)
        return
      }
      lastPaint = now
      // 大块数据到达时自适应加速追赶；不拆开 UTF-16 代理对。
      const count = reducedMotion ? next.length : Math.max(1, Math.ceil(elapsed * .08), Math.ceil((next.length - offset) / 8))
      let end = Math.min(next.length, offset + count)
      const last = next.charCodeAt(end - 1)
      if (end < next.length && last >= 0xd800 && last <= 0xdbff) end += 1
      if (end > offset) {
        text.appendData(next.slice(offset, end))
        offset = end
        progress.current()
      }
      if (offset < next.length) frame = requestAnimationFrame(paint)
    }

    wake.current = () => { if (frame === null) frame = requestAnimationFrame(paint) }
    wake.current()
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      wake.current = null
    }
  }, [])

  return <div className="studio-assistant__stream-text" aria-busy="true">
    <span ref={element} />
    {!content && <span>正在生成…</span>}
    <span className="studio-assistant__typing-cursor" aria-hidden="true" />
  </div>
})
