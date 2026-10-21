import { useCallback, useLayoutEffect, useRef } from 'react'

// 消息增长和容器缩放继续跟随；只有向上浏览才暂停，不把布局变化误当成用户意图。
export function useChatAutoScroll(active: boolean, conversationKey?: string | null) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const frame = useRef<number | null>(null)
  const position = useRef({ top: 0, height: 0, viewport: 0 })

  const followOutput = useCallback(() => {
    if (!following.current || frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      const body = bodyRef.current
      if (!body || !following.current) return
      body.scrollTop = body.scrollHeight
      position.current = { top: body.scrollTop, height: body.scrollHeight, viewport: body.clientHeight }
    })
  }, [])

  const scrollToLatest = useCallback(() => {
    following.current = true
    followOutput()
  }, [followOutput])

  useLayoutEffect(() => {
    const body = bodyRef.current
    const content = contentRef.current
    if (!active || !body || !content) return

    scrollToLatest()
    const pause = () => { if (body.scrollHeight > body.clientHeight) following.current = false }
    const onWheel = (event: WheelEvent) => { if (event.deltaY < 0) pause() }
    let touchY: number | undefined
    const onTouchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY }
    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY
      if (touchY !== undefined && nextY !== undefined && nextY > touchY) pause()
      touchY = nextY
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)) pause()
    }
    const onScroll = () => {
      const previous = position.current
      const top = Math.max(0, Math.min(body.scrollTop, body.scrollHeight - body.clientHeight))
      // 拖动滚动条也视为主动浏览；内容重排导致的滚动位置变化不暂停跟随。
      const movedUp = top < previous.top - 1 && body.scrollHeight === previous.height && body.clientHeight === previous.viewport
      if (movedUp) following.current = false
      else if (body.scrollHeight - top - body.clientHeight <= 2) following.current = true
      position.current = { top, height: body.scrollHeight, viewport: body.clientHeight }
    }
    const observer = new ResizeObserver(followOutput)
    observer.observe(body)
    observer.observe(content)
    body.addEventListener('scroll', onScroll, { passive: true })
    body.addEventListener('wheel', onWheel, { passive: true })
    body.addEventListener('touchstart', onTouchStart, { passive: true })
    body.addEventListener('touchmove', onTouchMove, { passive: true })
    body.addEventListener('keydown', onKeyDown)
    return () => {
      observer.disconnect()
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
      body.removeEventListener('scroll', onScroll)
      body.removeEventListener('wheel', onWheel)
      body.removeEventListener('touchstart', onTouchStart)
      body.removeEventListener('touchmove', onTouchMove)
      body.removeEventListener('keydown', onKeyDown)
    }
  }, [active, conversationKey, followOutput, scrollToLatest])

  return { bodyRef, contentRef, followOutput, scrollToLatest }
}
