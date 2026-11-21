import { useEffect, useRef, type CSSProperties } from 'react'
import type { MotionValue } from 'motion/react'
import { solarScene } from './solarScene'
import { createCelestialBodies } from './CelestialBodies'

/** 天空、地球与月亮共享时间光照；天体渲染与入口操作保持独立。 */
export function GenesisUniverse({ minute, displayedMinute, paused, active }: { minute: number; displayedMinute: MotionValue<number>; paused: boolean; active: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elapsed = useRef(0)
  const activePortal = useRef(active)
  const motion = useRef({ x: 0, y: 0, targetX: 0, targetY: 0, pull: 0, portalX: .5, portalY: .5 })
  const light = solarScene(minute)
  useEffect(() => { activePortal.current = active }, [active])
  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    const page = host.parentElement
    if (!page) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scene = document.createElement('canvas')
    const background = scene.getContext('2d')
    if (!background) return
    const bodies = createCelestialBodies()
    host.dataset.ready = 'true'
    let width = 0, height = 0, frame = 0, last = 0, radius = 0, centerY = 0
    let visible = true
    let sun = solarScene(displayedMinute.get())
    let paintedMinute = Number.NaN
    let bounds = host.getBoundingClientRect()
    let portals: { x: number; y: number }[] = []

    function measure() {
      if (!host || !page) return
      bounds = host.getBoundingClientRect()
      // 只在布局变化时读取入口位置；逐帧吸引光流不触发布局计算。
      portals = [...page.querySelectorAll('.home-portal-art')].map(element => {
        const rect = element.getBoundingClientRect()
        return { x: (rect.left + rect.width / 2 - bounds.left) / bounds.width, y: (rect.top + rect.height / 2 - bounds.top) / bounds.height }
      })
    }
    function onPointerMove(event: PointerEvent) {
      if (paused || event.pointerType !== 'mouse') return
      motion.current.targetX = Math.max(-1, Math.min(1, (event.clientX - bounds.left) / bounds.width * 2 - 1))
      motion.current.targetY = Math.max(-1, Math.min(1, (event.clientY - bounds.top) / bounds.height * 2 - 1))
    }
    function onPointerLeave() { motion.current.targetX = 0; motion.current.targetY = 0 }

    function paintScene() {
      if (!background) return
      const daylight = sun.daylight
      const warmth = sun.twilight
      const sunX = width * (.5 - Math.cos(sun.angle) * .43)
      const sunY = height * (.13 + (1 - daylight) * .2)
      const sky = background.createLinearGradient(0, 0, 0, height)
      sky.addColorStop(0, '#080d16')
      sky.addColorStop(.55, `rgb(${Math.round(7 + warmth * 15)}, ${Math.round(12 + daylight * 10 + warmth * 5)}, ${Math.round(23 + daylight * 18)})`)
      sky.addColorStop(1, '#080c12')
      background.fillStyle = sky
      background.fillRect(0, 0, width, height)
      for (let i = 0; i < 150; i++) {
        background.globalAlpha = (.2 + i % 4 * .13) * (1 - daylight * .8)
        background.fillStyle = '#d9e6f4'
        background.fillRect(((i * .6180339) % 1) * width, ((i * .4142135) % 1) * height, i % 7 === 0 ? 1.6 : .7, i % 7 === 0 ? 1.6 : .7)
      }
      background.globalAlpha = 1
      const sunlightVisibility = Math.max(0, Math.min(1, (sun.elevation + .28) / .2))
      if (sunlightVisibility > 0) {
        background.globalAlpha = sunlightVisibility
        const glow = background.createRadialGradient(sunX, sunY, 0, sunX, sunY, width * .38)
        glow.addColorStop(0, `rgba(255,${Math.round(226 - warmth * 52)},${Math.round(195 - warmth * 90)},.48)`)
        glow.addColorStop(.12, `rgba(245,${Math.round(210 - warmth * 70)},${Math.round(160 - warmth * 65)},.17)`)
        glow.addColorStop(1, 'rgba(90,130,180,0)')
        background.fillStyle = glow
        background.fillRect(0, 0, width, height)
        const core = background.createRadialGradient(sunX, sunY, 0, sunX, sunY, 24)
        core.addColorStop(0, '#fff8e8')
        core.addColorStop(.22, '#ffeed5')
        core.addColorStop(.38, 'rgba(255,222,167,.5)')
        core.addColorStop(1, 'rgba(255,211,150,0)')
        background.fillStyle = core
        background.fillRect(sunX - 24, sunY - 24, 48, 48)
      }
      background.globalAlpha = 1
    }

    function draw(delta = 0) {
      if (!ctx) return
      const nextMinute = displayedMinute.get()
      if (nextMinute !== paintedMinute) {
        sun = solarScene(nextMinute)
        paintScene()
        paintedMinute = nextMinute
      }
      elapsed.current += delta * .001
      const time = elapsed.current
      const state = motion.current
      const ease = 1 - Math.exp(-delta / 520)
      const portal = activePortal.current === null ? undefined : portals[activePortal.current]
      state.x += (state.targetX - state.x) * ease
      state.y += (state.targetY - state.y) * ease
      state.pull += ((portal ? 1 : 0) - state.pull) * ease
      if (portal) {
        state.portalX += (portal.x - state.portalX) * ease
        state.portalY += (portal.y - state.portalY) * ease
      }
      ctx.clearRect(0, 0, width, height)
      // 地表、天空与近处光带以不同幅度响应指针，文字与点击区域始终不动。
      ctx.save()
      ctx.translate(width * .012 * (state.x * .65 + Math.sin(time * .13) * .35), height * .008 * (state.y * .65 + Math.sin(time * .17) * .35))
      ctx.translate(width / 2, height / 2)
      ctx.scale(1.035, 1.035)
      ctx.translate(-width / 2, -height / 2)
      ctx.drawImage(scene, 0, 0, width, height)

      bodies?.draw(ctx, width / 2, centerY, radius, time, sun)
      ctx.restore()

      // 整屏光带缓慢穿行；入口聚焦时只弯曲光流，不移动真实导航。
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      const tint = `${Math.round(115 + sun.twilight * 104)},${Math.round(191 - sun.twilight * 13)},${Math.round(216 - sun.twilight * 79)}`
      const wash = ctx.createRadialGradient(width * (.5 + Math.sin(time * .19) * .3), height * .48, 0, width * .5, height * .55, width * .6)
      wash.addColorStop(0, `rgba(${tint},.035)`)
      wash.addColorStop(1, `rgba(${tint},0)`)
      ctx.fillStyle = wash
      ctx.fillRect(0, 0, width, height)
      for (let band = 0; band < 3; band++) {
        const samples = 80
        const points: { x: number; y: number; spread: number }[] = []
        for (let step = 0; step <= samples; step++) {
          const p = step / samples
          const envelope = Math.sin(p * Math.PI)
          const x = p * (width + 120) - 60
          let y = height * (.38 + band * .095 + Math.sin(p * Math.PI * 1.7 + time * .24 + band * .8) * .115)
          y += Math.sin(p * Math.PI * 3 - time * .18 + band) * height * .028 + state.y * 24 * envelope
          const attraction = Math.exp(-Math.pow((p - state.portalX) / .22, 2)) * state.pull * .88
          y += (state.portalY * height - y) * attraction
          points.push({ x, y, spread: height * .085 * envelope * (1 - attraction * .8) })
        }
        const sheen = ctx.createLinearGradient(0, 0, width, 0)
        sheen.addColorStop(0, `rgba(${tint},0)`)
        sheen.addColorStop(.22, `rgba(${tint},.18)`)
        sheen.addColorStop(.58, `rgba(${tint},.4)`)
        sheen.addColorStop(1, `rgba(${tint},0)`)
        ctx.strokeStyle = sheen
        ctx.lineWidth = .8
        ctx.save()
        ctx.translate(state.x * (18 + band * 7), 0)
        for (let strand = 0; strand < 18; strand++) {
          const offset = strand / 17 - .5
          ctx.globalAlpha = .24 + .45 * Math.pow(Math.abs(offset) * 2, 3)
          ctx.beginPath()
          for (const [index, point] of points.entries()) {
            const y = point.y + offset * point.spread
            if (index === 0) ctx.moveTo(point.x, y)
            else ctx.lineTo(point.x, y)
          }
          ctx.stroke()
        }
        // 沿光带滑行的亮段提供可立即感知的运动，避免高频闪烁与密集粒子。
        for (let trail = 0; trail < 2; trail++) {
          const progress = (time * .065 + band * .23 + trail * .5) % 1
          const start = Math.floor(progress * samples)
          ctx.globalAlpha = Math.sin(progress * Math.PI) * .7
          ctx.lineWidth = 1.5
          ctx.beginPath()
          for (let index = Math.max(0, start - 5); index <= start; index++) {
            const point = points[index]!
            if (index === Math.max(0, start - 5)) ctx.moveTo(point.x, point.y)
            else ctx.lineTo(point.x, point.y)
          }
          ctx.stroke()
        }
        ctx.restore()
      }
      ctx.restore()
    }
    function tick(now: number) {
      draw(last ? Math.min(now - last, 40) : 16)
      last = now
      frame = requestAnimationFrame(tick)
    }
    function sync() {
      cancelAnimationFrame(frame)
      last = 0
      if (!document.hidden && visible) { draw(); if (!paused) frame = requestAnimationFrame(tick) }
    }
    function resize() {
      if (!canvas || !host || !ctx) return
      width = host.clientWidth
      height = host.clientHeight
      if (!width || !height) return
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      scene.width = Math.round(width)
      scene.height = Math.round(height)
      radius = width <= 760 ? width * .39 : Math.min(width * .28, height * .30)
      centerY = height * (width <= 760 ? .54 : .60)
      bodies?.resize(width <= 760)
      paintedMinute = Number.NaN
      measure()
      draw()
    }
    const resizeObserver = new ResizeObserver(resize)
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync() })
    resizeObserver.observe(host)
    observer.observe(host)
    document.addEventListener('visibilitychange', sync)
    page.addEventListener('pointermove', onPointerMove, { passive: true })
    page.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('scroll', measure, { passive: true })
    const stopLightUpdates = displayedMinute.on('change', () => {
      // 暂停的是环境运动；用户主动调整时间仍有过渡，减少动态效果时由上层直接跳至目标。
      if (paused && visible && !document.hidden && width > 0) draw()
    })
    resize()
    sync()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      page.removeEventListener('pointermove', onPointerMove)
      page.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('scroll', measure)
      stopLightUpdates()
      delete host.dataset.ready
    }
  }, [displayedMinute, paused])
  return <div className="home-cosmos" aria-hidden="true" style={{ '--solar-position': `${50 - Math.cos(light.angle) * 43}%` } as CSSProperties}><canvas ref={canvasRef} /></div>
}
