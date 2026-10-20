import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useCursorTheme } from './preferences'
import { drawFantasyCursor, isFantasyTheme } from './fantasy'
import { isArrowSkin } from './arrowSkinAssets'
import { ArrowSkinEffects } from './ArrowSkinEffects'
import './CursorEffects.css'
import { effectCursorScale } from './sizing'
import { createDrawingSurface } from './drawingSurface'

type Sample = { x: number; y: number; born: number }

export function CursorEffects() {
  const theme = useCursorTheme()
  const layer = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const host = layer.current
    const surface = canvas.current
    if (theme === 'system' || isArrowSkin(theme) || !host || !surface) return
    const context = surface.getContext('2d')
    if (!context) return
    const drawing = createDrawingSurface(surface, context)
    const shape = host.querySelector<HTMLElement>('.genesis-cursor__shape')
    const fantasy = isFantasyTheme(theme)
    const hasSamples = theme === 'gooey' || theme === 'crayon' || theme === 'emitter' || theme === 'quill' || theme === 'starlight'
    const renderScale = effectCursorScale(theme)
    host.style.setProperty('--cursor-scale', String(renderScale))
    const fine = matchMedia('(any-pointer: fine)')
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const forced = matchMedia('(forced-colors: active)')
    let frame = 0
    let active = false
    let pressed = false
    let hovering = false
    let x = 0, y = 0, lagX = 0, lagY = 0
    let pulse = 0, pulseX = 0, pulseY = 0
    let moved = false
    let target: Element | null = null
    let native = false
    let selecting = window.getSelection()?.isCollapsed === false
    let samples: Sample[] = []
    const body = Array.from({ length: 16 }, () => ({ x: 0, y: 0 }))

    function hide() {
      target?.removeAttribute('data-genesis-cursor-target')
      target = null
      if (!active) return
      active = false
      pressed = false
      host!.dataset.pressed = 'false'
      samples = []; moved = false; pulse = 0
      document.documentElement.removeAttribute('data-genesis-cursor')
      host!.hidden = true
      cancelAnimationFrame(frame)
      frame = 0
      drawing.clear()
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
      const dx = x - lagX, dy = y - lagY
      lagX += dx * .24
      lagY += dy * .24
      const speed = reduced.matches ? 0 : Math.min(Math.hypot(dx, dy), 40)
      if (theme === 'follower') {
        host!.style.setProperty('--cursor-angle', `${Math.atan2(dy, dx)}rad`)
        host!.style.setProperty('--cursor-stretch', String(1 + Math.min(speed / 45, .15)))
      }
      samples = samples.filter(p => time - p.born < (theme === 'crayon' ? 950 : fantasy ? 700 : 420))
      if (moved && hasSamples && !reduced.matches && (theme !== 'crayon' || pressed)) {
        const last = samples.at(-1)
        if (!last || Math.hypot(x - last.x, y - last.y) > 2) {
          samples.push({ x, y, born: time })
          if (samples.length > 36) samples.shift()
        }
      }
      moved = false
      const unsettled = !reduced.matches && (theme === 'follower' || fantasy) && Math.hypot(dx, dy) > .2
      const pulsing = !reduced.matches && pulse > 0 && time - pulse < (fantasy ? 700 : 500)
      // 跟随造型由合成层直接显示，只有点击涟漪需要位图。
      if (theme === 'follower' && !pulsing) {
        drawing.clear()
        if (unsettled) frame = requestAnimationFrame(draw)
        return
      }
      const bounds = [{ x, y }, ...samples]
      if (theme === 'dragon') bounds.push(...body)
      if (pulse > 0 && time - pulse < (fantasy ? 700 : 500)) {
        bounds.push(fantasy ? { x: pulseX, y: pulseY } : { x: x + (pulseX - x) / renderScale, y: y + (pulseY - y) / renderScale })
      }
      if (!drawing.begin(bounds, Math.max(54 * renderScale + 3, fantasy ? 0 : 37), renderScale, { x, y })) return
      context!.fillStyle = '#fff'
      context!.strokeStyle = '#fff'
      // 围绕真实落点缩放造型，鼠标坐标与命中位置保持不变。
      context!.save()
      context!.translate(x, y)
      context!.scale(renderScale, renderScale)
      context!.translate(-x, -y)
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
        dot(x, y, pressed ? 6 : 9)
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
      context!.restore()
      if (!fantasy && pulse > 0 && time - pulse < 500 && !reduced.matches) {
        const progress = (time - pulse) / 500
        context!.globalAlpha = 1 - progress
        context!.lineWidth = 1
        context!.beginPath(); context!.arc(pulseX, pulseY, 4 + progress * 32, 0, Math.PI * 2); context!.stroke()
      }
      context!.globalAlpha = 1
      if (samples.length || unsettled || pulsing) frame = requestAnimationFrame(draw)
    }

    function schedule() { if (!frame) frame = requestAnimationFrame(draw) }

    function move(event: PointerEvent) {
      const nextTarget = event.target instanceof Element ? event.target : null
      // 输入、选择、画布拖拽、原生弹窗与系统特殊光标始终交还浏览器。
      if (!fine.matches || forced.matches || document.hidden || event.pointerType !== 'mouse' || !nextTarget || selecting) { hide(); return }
      if (nextTarget !== target) {
        target?.removeAttribute('data-genesis-cursor-target')
        target = nextTarget
        // 仅在进入新元素时读取样式；先撤掉覆盖，才能识别原有的拖拽、缩放光标。
        native = Boolean(target.closest('input, textarea, select, button:disabled, [aria-disabled="true"], [contenteditable]:not([contenteditable="false"]), .cm-editor, .react-flow, dialog, video, iframe, [data-native-cursor]')) ||
          /^(text|vertical-text|grab|grabbing|move|not-allowed|wait|progress|crosshair|.*-resize)$/.test(getComputedStyle(target).cursor)
        const nextHover = Boolean(target.closest('button:not(:disabled), a[href], [role="button"]:not([aria-disabled="true"])'))
        if (hovering !== nextHover) { hovering = nextHover; host!.dataset.hover = String(hovering) }
        if (!native) target.setAttribute('data-genesis-cursor-target', '')
      }
      if (native || target.closest('button:disabled, [aria-disabled="true"]')) { hide(); return }
      x = event.clientX; y = event.clientY
      if (!active) {
        lagX = x; lagY = y; samples = []
        body.forEach((p, i) => { p.x = x - i * 3.4; p.y = y + Math.sin(i * .45) * 9 })
      }
      if (!active) {
        active = true
        host!.hidden = false
        document.documentElement.dataset.genesisCursor = theme
      }
      // 主造型直接使用最新输入坐标，变形与粒子再按显示帧率绘制。
      if (shape) shape.style.translate = `${x}px ${y}px`
      moved = true
      schedule()
    }
    function press(event: PointerEvent) {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('p, h1, h2, h3, h4, li, pre, blockquote') && !target.closest('button, a')) { hide(); return }
      if (active) { pressed = true; host!.dataset.pressed = 'true'; samples = []; pulse = performance.now(); pulseX = x; pulseY = y; schedule() }
    }
    function release() { pressed = false; host!.dataset.pressed = 'false'; if (active) schedule() }
    function keyboard() { hide() }
    function visibility() { if (document.hidden) hide() }
    function selection() {
      selecting = window.getSelection()?.isCollapsed === false
      if (selecting) hide()
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', press)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', hide)
    document.documentElement.addEventListener('pointerleave', hide)
    window.addEventListener('blur', hide)
    window.addEventListener('keydown', keyboard)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('selectionchange', selection)
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
      window.removeEventListener('resize', hide)
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('selectionchange', selection)
      fine.removeEventListener('change', hide)
      forced.removeEventListener('change', hide)
      reduced.removeEventListener('change', hide)
    }
  }, [theme])

  if (isArrowSkin(theme)) return <ArrowSkinEffects skin={theme} />
  if (theme === 'system') return null
  return createPortal(<div ref={layer} className={`genesis-cursor genesis-cursor--${theme}`} aria-hidden="true" hidden>
    <canvas ref={canvas} width={1} height={1} /><div className="genesis-cursor__shape" />
  </div>, document.body)
}
