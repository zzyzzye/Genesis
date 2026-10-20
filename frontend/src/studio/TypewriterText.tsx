import { memo, useEffect, useRef } from 'react'

/** 逐字呈现只追加文本节点，避免逐字解析 Markdown 或重绘整个会话。 */
export const TypewriterText = memo(function TypewriterText({ content, onProgress, onComplete, inline = false, charactersPerSecond }: {
  content: string
  onProgress: () => void
  onComplete?: () => void
  inline?: boolean
  charactersPerSecond?: number
}) {
  const element = useRef<HTMLSpanElement>(null)
  const target = useRef('')
  const progress = useRef(onProgress)
  const complete = useRef(onComplete)
  const speed = useRef(charactersPerSecond)
  const wake = useRef<(() => void) | null>(null)

  useEffect(() => {
    target.current = content
    progress.current = onProgress
    complete.current = onComplete
    speed.current = charactersPerSecond
    wake.current?.()
  }, [content, onProgress, onComplete, charactersPerSecond])

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
    let completedFor = ''
    let characterBudget = 0

    function paint(now: number) {
      frame = null
      const next = target.current
      if (next !== previous && !next.startsWith(previous)) {
        text.data = ''
        offset = 0
        completedFor = ''
        characterBudget = 0
      }
      previous = next
      const elapsed = lastPaint ? Math.min(now - lastPaint, 100) : 32
      if (elapsed < 32 && offset < next.length) {
        frame = requestAnimationFrame(paint)
        return
      }
      lastPaint = now
      // 指定速度时累计小数额度，避免每帧取整导致实际速度翻倍；聊天仍自适应追赶。
      if (speed.current) characterBudget += elapsed * speed.current / 1000
      const count = reducedMotion ? next.length : speed.current
        ? Math.max(0, Math.floor(characterBudget))
        : Math.max(1, Math.ceil(elapsed * .08), Math.ceil((next.length - offset) / 8))
      let end = Math.min(next.length, offset + count)
      const last = next.charCodeAt(end - 1)
      if (end < next.length && last >= 0xd800 && last <= 0xdbff) end += 1
      if (end > offset) {
        if (speed.current) characterBudget -= end - offset
        text.appendData(next.slice(offset, end))
        offset = end
        progress.current()
      }
      if (offset < next.length) frame = requestAnimationFrame(paint)
      else if (next && completedFor !== next) {
        completedFor = next
        complete.current?.()
      }
    }

    wake.current = () => { if (frame === null) frame = requestAnimationFrame(paint) }
    wake.current()
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      wake.current = null
    }
  }, [])

  if (inline) return <span className="typewriter-inline" aria-busy="true">
    <span ref={element} /><span className="typewriter-inline__cursor" aria-hidden="true" />
  </span>

  return <div className="studio-assistant__stream-text" aria-busy="true">
    <span ref={element} />
    {!content && <span>正在生成…</span>}
    <span className="studio-assistant__typing-cursor" aria-hidden="true" />
  </div>
})
