import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useCursorTheme } from './preferences'
import { drawFantasyCursor, isFantasyTheme } from './fantasy'
import './CursorEffects.css'

type Sample = { x: number; y: number; born: number }

export function CursorEffects() {
  const theme = useCursorTheme()
  const layer = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = layer.current
    const surface = canvas.current
    if (theme === 'system' || !host || !surface) return
    const context = surface.getContext('2d')
    if (!context) return
    const fine = matchMedia('(any-pointer: fine)')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const forced = matchMedia('(forced-colors: active)')
    let frame = 0
    let active = false
    let pressed = false
    let hovering = false
    let x = 0, y = 0, previousX = 0, previousY = 0, lagX = 0, lagY = 0
    let pulse = 0, pulseX = 0, pulseY = 0
    let magnetX = 0, magnetY = 0
    let samples: Sample[] = []
    const body = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }))

    function hide() {
      active = false
      pressed = false
      samples = []
      document.documentElement.removeAttribute('data-genesis-cursor')
      host!.hidden = true
      cancelAnimationFrame(frame)
      frame = 0
    }

    function resize() {
      const ratio = Math.min(devicePixelRatio || 1, 2)
      surface!.width = innerWidth * ratio
      surface!.height = innerHeight * ratio
      context!.setTransform(ratio, 0, 0, ratio, 0, 0)
      hide()
    }

    function dot(cx: number, cy: number, radius: number, opacity = 1) {
      context!.globalAlpha = opacity
      context!.beginPath()
      context!.arc(cx, cy, radius, 0, Math.PI * 2)
      context!.fill()
    }

    function draw(time: number) {
      frame = 0
      if (!active) return
      context!.clearRect(0, 0, innerWidth, innerHeight)
      context!.fillStyle = '#fff'
      context!.strokeStyle = '#fff'
      const dx = x - lagX, dy = y - lagY
      lagX += dx * .24
      lagY += dy * .24
      const speed = reduced.matches ? 0 : Math.min(Math.hypot(dx, dy), 40)
      host!.style.setProperty('--cursor-x', `${x + magnetX}px`)
      host!.style.setProperty('--cursor-y', `${y + magnetY}px`)
      host!.style.setProperty('--cursor-angle', `${Math.atan2(dy, dx)}rad`)
      host!.style.setProperty('--cursor-stretch', String(1 + speed / 45))
      host!.dataset.hover = String(hovering)
      host!.dataset.pressed = String(pressed)
      samples = samples.filter(p => time - p.born < (theme === 'crayon' ? 950 : isFantasyTheme(theme) ? 700 : 420))
      if (isFantasyTheme(theme)) {
        body[0] = { x, y }
        for (let i = 1; i < body.length; i++) {
          const before = body[i - 1], p = body[i]
          if (!before || !p) continue
          if (reduced.matches) { p.x = x - i * 3.4; p.y = y + Math.sin(i * .45) * 9; continue }
          const angle = Math.atan2(p.y - before.y, p.x - before.x)
          p.x += (before.x + Math.cos(angle) * 4 - p.x) * .65
          p.y += (before.y + Math.sin(angle) * 4 - p.y) * .65
        }
        drawFantasyCursor(context!, theme, { x, y, time, speed, hovering, pressed, reduced: reduced.matches, pulse, pulseX, pulseY, samples, body })
      } else if (theme === 'gooey') {
        dot(x, y, pressed ? 6 : hovering ? 17 : 9)
        if (!reduced.matches) samples.forEach((p, i) => dot(p.x, p.y, Math.max(1, 9 * (i + 1) / samples.length), .4 * (1 - (time - p.born) / 420)))
        if (time - pulse < 450 && !reduced.matches) for (let i = 0; i < 5; i++) {
          const a = i / 5 * Math.PI * 2, r = Math.sin((time - pulse) / 450 * Math.PI) * 25
          dot(x + Math.cos(a) * r, y + Math.sin(a) * r, 3)
        }
      } else if (theme === 'crayon') {
        context!.lineWidth = 1.3
        samples.forEach((p, i) => {
          const before = samples[i - 1]
          if (!before) return
          context!.globalAlpha = (1 - (time - p.born) / 950) * .7
          for (let j = 0; j < 3; j++) {
            context!.beginPath()
            context!.moveTo(before.x + j * 1.6, before.y - j)
            context!.lineTo(p.x + j * 1.6, p.y - j)
            context!.stroke()
          }
        })
        context!.globalAlpha = 1
        context!.save()
        context!.translate(x, y)
        context!.rotate(-.5)
        context!.fillRect(hovering ? -3 : -2, -15, hovering ? 6 : 4, 14)
        context!.beginPath(); context!.moveTo(-2, -1); context!.lineTo(2, -1); context!.lineTo(0, 3); context!.fill()
        context!.restore()
      } else if (theme === 'emitter') {
        dot(x, y, hovering ? 4 : 2.5)
        context!.lineWidth = .8
        samples.forEach(p => {
          const age = (time - p.born) / 420
          context!.globalAlpha = (1 - age) * .4
          context!.beginPath(); context!.ellipse(p.x, p.y, 5 + age * 24, 5 + age * 15, 0, 0, Math.PI * 2); context!.stroke()
        })
      } else if (theme === 'lens') dot(x, y, 2)
      else dot(x, y, 2)
      if (!isFantasyTheme(theme) && pulse > 0 && time - pulse < 500 && !reduced.matches) {
        const progress = (time - pulse) / 500
        context!.globalAlpha = 1 - progress
        context!.lineWidth = 1
        context!.beginPath(); context!.arc(pulseX, pulseY, 4 + progress * 32, 0, Math.PI * 2); context!.stroke()
      }
      context!.globalAlpha = 1
      const unsettled = Math.hypot(dx, dy) > .2
      if (samples.length || unsettled || (!reduced.matches && pulse > 0 && time - pulse < (isFantasyTheme(theme) ? 700 : 500))) frame = requestAnimationFrame(draw)
    }

    function schedule() { if (!frame) frame = requestAnimationFrame(draw) }

    function move(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null
      // 输入、选择、画布拖拽、原生弹窗与系统特殊光标始终交还浏览器。
      if (!fine.matches || forced.matches || event.pointerType !== 'mouse' || !target ||
        target.closest('input, textarea, select, button:disabled, [aria-disabled="true"], [contenteditable]:not([contenteditable="false"]), .cm-editor, .react-flow, dialog, video, iframe, [data-native-cursor]') ||
        ['text', 'vertical-text', 'grab', 'grabbing', 'move', 'not-allowed', 'wait', 'progress', 'crosshair', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize'].includes(getComputedStyle(target).cursor) ||
        (window.getSelection()?.toString().length ?? 0) > 0) { hide(); return }
      const now = performance.now()
      previousX = x; previousY = y; x = event.clientX; y = event.clientY
      if (!active) {
        lagX = x; lagY = y; previousX = x; previousY = y; samples = []
        body.forEach((p, i) => { p.x = x - i * 3.4; p.y = y + Math.sin(i * .45) * 9 })
      }
      active = true
      host!.hidden = false
      document.documentElement.dataset.genesisCursor = theme
      hovering = Boolean(target.closest('button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"])'))
      magnetX = 0; magnetY = 0
      if (theme === 'follower' && hovering && !reduced.matches) {
        const bounds = target.closest('button, a, [role="button"]')!.getBoundingClientRect()
        magnetX = Math.max(-12, Math.min(12, (bounds.left + bounds.width / 2 - x) * .18))
        magnetY = Math.max(-12, Math.min(12, (bounds.top + bounds.height / 2 - y) * .18))
      }
      host!.dataset.label = hovering ? (target.closest('[data-cursor-label]')?.getAttribute('data-cursor-label')?.slice(0, 4) || (target.closest('a') ? '前往' : '操作')) : ''
      const shape = host!.querySelector<HTMLElement>('.genesis-cursor__shape')
      if (shape) shape.dataset.label = host!.dataset.label
      if (!reduced.matches && Math.hypot(x - previousX, y - previousY) > 2 && (theme !== 'crayon' || pressed)) {
        samples.push({ x, y, born: now })
        samples = samples.slice(-36)
      }
      schedule()
    }
    function press(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('p, h1, h2, h3, h4, li, pre, blockquote') && !target.closest('button, a')) { hide(); return }
      if (active) { pressed = true; samples = []; pulse = performance.now(); pulseX = x; pulseY = y; schedule() }
    }
    function release() { pressed = false; if (active) schedule() }
    function keyboard() { hide() }
    function visibility() { if (document.hidden) hide() }
    resize()
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', press)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', hide)
    document.documentElement.addEventListener('pointerleave', hide)
    window.addEventListener('blur', hide)
    window.addEventListener('keydown', keyboard)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', visibility)
    fine.addEventListener('change', hide)
    forced.addEventListener('change', hide)
    reduced.addEventListener('change', hide)
    return () => {
      hide()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', press)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', hide)
      document.documentElement.removeEventListener('pointerleave', hide)
      window.removeEventListener('blur', hide)
      window.removeEventListener('keydown', keyboard)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', visibility)
      fine.removeEventListener('change', hide)
      forced.removeEventListener('change', hide)
      reduced.removeEventListener('change', hide)
    }
  }, [theme])

  if (theme === 'system') return null
  return createPortal(<div ref={layer} className={`genesis-cursor genesis-cursor--${theme}`} aria-hidden="true" hidden>
    <canvas ref={canvas} /><div className="genesis-cursor__shape" />
  </div>, document.body)
}
