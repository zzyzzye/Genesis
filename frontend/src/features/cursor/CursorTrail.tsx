import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useCursorTrail } from './preferences'
import { drawTrail, type TrailPoint } from './trailDrawing'
import { createDrawingSurface } from './drawingSurface'

export function CursorTrail() {
  const style = useCursorTrail()
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current
    if (style === 'none' || !surface || typeof CanvasRenderingContext2D === 'undefined') return
    const ctx = surface.getContext('2d')
    if (!ctx) return
    const drawing = createDrawingSurface(surface, ctx)
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const forced = matchMedia('(forced-colors: active)')
    const fine = matchMedia('(any-pointer: fine)')
    let points: TrailPoint[] = [], frame = 0
    let pending: TrailPoint | null = null
    let lastTarget: EventTarget | null = null
    let native = false
    let selecting = window.getSelection()?.isCollapsed === false
    function clear() {
      points = []; pending = null; cancelAnimationFrame(frame); frame = 0
      lastTarget = null; drawing.clear()
    }
    function draw(now: number) {
      frame = 0; points = points.filter(p => now - p.born < 620)
      if (pending) {
        const last = points.at(-1)
        if (!last || Math.hypot(last.x - pending.x, last.y - pending.y) >= 3) {
          points.push(pending)
          if (points.length > 64) points.shift()
        }
        pending = null
      }
      if (drawing.begin(points, 20)) drawTrail(ctx!, style, points, now)
      if (points.length) frame = requestAnimationFrame(draw)
    }
    function move(event: PointerEvent) {
      if (lastTarget !== event.target) {
        lastTarget = event.target
        native = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), .cm-editor, .react-flow, dialog, video, iframe, [data-native-cursor]'))
      }
      if (event.pointerType !== 'mouse' || !fine.matches || reduced.matches || forced.matches || document.hidden ||
        native || selecting) { clear(); return }
      // 同一帧的高频鼠标事件只保留最新坐标，拖尾不阻塞主光标。
      pending = { x: event.clientX, y: event.clientY, born: performance.now() }
      if (!frame) frame = requestAnimationFrame(draw)
    }
    function selection() {
      selecting = window.getSelection()?.isCollapsed === false
      if (selecting) clear()
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', clear)
    window.addEventListener('keydown', clear)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('resize', clear)
    document.documentElement.addEventListener('pointerleave', clear)
    document.addEventListener('visibilitychange', clear)
    document.addEventListener('selectionchange', selection)
    reduced.addEventListener('change', clear); forced.addEventListener('change', clear); fine.addEventListener('change', clear)
    return () => {
      clear()
      window.removeEventListener('pointermove', move); window.removeEventListener('blur', clear)
      window.removeEventListener('keydown', clear); window.removeEventListener('scroll', clear, true); window.removeEventListener('resize', clear)
      document.documentElement.removeEventListener('pointerleave', clear); document.removeEventListener('visibilitychange', clear)
      document.removeEventListener('selectionchange', selection)
      reduced.removeEventListener('change', clear); forced.removeEventListener('change', clear); fine.removeEventListener('change', clear)
    }
  }, [style])
  return style === 'none' ? null : createPortal(<canvas ref={canvas} data-cursor-trail={style} aria-hidden="true" width={1} height={1} style={{ position: 'fixed', top: 0, left: 0, pointerEvents: 'none', zIndex: 9998 }} />, document.body)
}
