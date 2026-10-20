import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useCursorTrail } from './preferences'
import { drawTrail, type TrailPoint } from './trailDrawing'

export function CursorTrail() {
  const style = useCursorTrail()
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current
    if (style === 'none' || !surface || typeof CanvasRenderingContext2D === 'undefined') return
    const ctx = surface.getContext('2d')
    if (!ctx) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const forced = matchMedia('(forced-colors: active)')
    const fine = matchMedia('(any-pointer: fine)')
    let points: TrailPoint[] = [], frame = 0
    function clear() {
      points = []; cancelAnimationFrame(frame); frame = 0
      ctx!.clearRect(0, 0, innerWidth, innerHeight)
    }
    function resize() {
      const ratio = Math.min(devicePixelRatio || 1, 2)
      surface!.width = innerWidth * ratio; surface!.height = innerHeight * ratio
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0); clear()
    }
    function draw(now: number) {
      frame = 0; points = points.filter(p => now - p.born < 620)
      ctx!.clearRect(0, 0, innerWidth, innerHeight)
      drawTrail(ctx!, style, points, now)
      if (points.length) frame = requestAnimationFrame(draw)
    }
    function move(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (event.pointerType !== 'mouse' || !fine.matches || reduced.matches || forced.matches || document.hidden ||
        target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), .cm-editor, .react-flow, dialog, iframe, [data-native-cursor]') || window.getSelection()?.toString()) { clear(); return }
      const last = points.at(-1)
      if (last && Math.hypot(last.x - event.clientX, last.y - event.clientY) < 3) return
      points.push({ x: event.clientX, y: event.clientY, born: performance.now() }); points = points.slice(-80)
      if (!frame) frame = requestAnimationFrame(draw)
    }
    resize()
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('blur', clear)
    window.addEventListener('keydown', clear)
    window.addEventListener('scroll', clear, true)
    window.addEventListener('resize', resize)
    document.documentElement.addEventListener('pointerleave', clear)
    document.addEventListener('visibilitychange', clear)
    reduced.addEventListener('change', clear); forced.addEventListener('change', clear); fine.addEventListener('change', clear)
    return () => {
      clear()
      window.removeEventListener('pointermove', move); window.removeEventListener('blur', clear)
      window.removeEventListener('keydown', clear); window.removeEventListener('scroll', clear, true); window.removeEventListener('resize', resize)
      document.documentElement.removeEventListener('pointerleave', clear); document.removeEventListener('visibilitychange', clear)
      reduced.removeEventListener('change', clear); forced.removeEventListener('change', clear); fine.removeEventListener('change', clear)
    }
  }, [style])
  return style === 'none' ? null : createPortal(<canvas ref={canvas} data-cursor-trail={style} aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9998 }} />, document.body)
}
