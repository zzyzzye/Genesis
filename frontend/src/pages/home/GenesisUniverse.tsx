import { useEffect, useRef, type CSSProperties } from 'react'
import { solarScene } from './solarScene'

/** 地平线光场按本地时刻变化；地表是程序纹理，不请求定位或外部地图。 */
export function GenesisUniverse({ minute, paused, active }: { minute: number; paused: boolean; active: number | null }) {
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
    host.dataset.ready = 'true'
    let width = 0, height = 0, frame = 0, last = 0, radius = 0, centerY = 0
    let visible = true
    const sun = solarScene(minute)
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
      const cx = width / 2
      radius = Math.max(width * .67, height * .9)
      centerY = height * .55 + radius
      const sunX = width * (.5 - Math.cos(sun.angle) * .43)
      const horizon = centerY - Math.sqrt(radius * radius - Math.pow(sunX - cx, 2))
      const sunY = horizon - sun.elevation * height * .48
      const sky = background.createLinearGradient(0, 0, 0, height)
      sky.addColorStop(0, '#080d16')
      sky.addColorStop(.55, `rgb(${Math.round(9 + warmth * 28)}, ${Math.round(15 + daylight * 27 + warmth * 10)}, ${Math.round(27 + daylight * 46)})`)
      sky.addColorStop(1, '#080c12')
      background.fillStyle = sky
      background.fillRect(0, 0, width, height)
      for (let i = 0; i < 150; i++) {
        background.globalAlpha = (.2 + i % 4 * .13) * (1 - daylight * .8)
        background.fillStyle = '#d9e6f4'
        background.fillRect(((i * .6180339) % 1) * width, ((i * .4142135) % 1) * height, i % 7 === 0 ? 1.6 : .7, i % 7 === 0 ? 1.6 : .7)
      }
      background.globalAlpha = 1
      if (sun.elevation > -.28) {
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
      // 光照只在时刻或尺寸变化时生成；逐帧复用缓存，避免重复计算地表。
      const terrain = document.createElement('canvas')
      const scale = Math.min(1, 720 / width, 600 / height)
      terrain.width = Math.ceil(width * scale)
      terrain.height = Math.ceil(height * scale)
      const surface = terrain.getContext('2d')
      if (surface) {
        const pixels = surface.createImageData(terrain.width, terrain.height)
        const lx = -Math.cos(sun.angle)
        const ly = -sun.elevation * .9
        const lz = sun.elevation * .65
        const length = Math.hypot(lx, ly, lz)
        for (let py = Math.floor(height * .55 * scale); py < terrain.height; py++) {
          for (let px = 0; px < terrain.width; px++) {
            const nx = (px / scale - cx) / radius
            const ny = (py / scale - centerY) / radius
            const squared = nx * nx + ny * ny
            if (squared >= 1) continue
            const nz = Math.sqrt(1 - squared)
            const diffuse = Math.max(0, (nx * lx + ny * ly + nz * lz) / length)
            const longitude = Math.atan2(nx, nz)
            const latitude = Math.asin(ny)
            const clouds = Math.max(0, Math.sin(longitude * 31 + Math.sin(latitude * 17) * 2) * Math.sin(latitude * 43 + Math.cos(longitude * 11) * 3) - .15)
            const texture = .93 + .07 * Math.sin(longitude * 82 + latitude * 43)
            const lit = diffuse * texture
            const cloud = clouds * diffuse * 18
            const index = (py * terrain.width + px) * 4
            pixels.data[index] = 5 + lit * (28 + warmth * 54) + cloud
            pixels.data[index + 1] = 11 + lit * (59 + warmth * 16) + cloud
            pixels.data[index + 2] = 19 + lit * 78 + cloud
            pixels.data[index + 3] = 255
          }
        }
        surface.putImageData(pixels, 0, 0)
        background.drawImage(terrain, 0, 0, width, height)
      }
      const rim = background.createLinearGradient(0, 0, width, 0)
      const litSide = Math.max(.02, Math.min(.98, sunX / width))
      rim.addColorStop(0, `rgba(70,132,210,${.12 + daylight * .1})`)
      rim.addColorStop(litSide, sun.elevation > -.28 ? `rgba(${Math.round(105 + warmth * 150)},${Math.round(185 + warmth * 20)},${Math.round(255 - warmth * 108)},.9)` : 'rgba(62,112,204,.34)')
      rim.addColorStop(1, `rgba(70,132,210,${.12 + daylight * .1})`)
      background.strokeStyle = rim
      for (const [lineWidth, opacity] of [[64, .025], [32, .05], [16, .09], [7, .2], [2, .85]]) {
        background.lineWidth = lineWidth!
        background.globalAlpha = opacity!
        background.beginPath()
        background.arc(cx, centerY, radius, 0, Math.PI * 2)
        background.stroke()
      }
      background.globalAlpha = 1
    }

    function draw(delta = 0) {
      if (!ctx) return
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

      // 连续球面投影表现转动，避免用轻微摆动的平面线条冒充自转。
      ctx.save()
      ctx.beginPath()
      ctx.arc(width / 2, centerY, radius - 3, 0, Math.PI * 2)
      ctx.clip()
      ctx.strokeStyle = '#8ec5e0'
      ctx.lineWidth = .7
      ctx.globalAlpha = .13 + sun.daylight * .06
      function spherePoint(latitude: number, longitude: number) {
        const x = Math.cos(latitude) * Math.sin(longitude)
        const y = Math.sin(latitude)
        const z = Math.cos(latitude) * Math.cos(longitude)
        return { x: width / 2 + radius * x, y: centerY + radius * (y * .94 + z * .342), visible: -y * .342 + z * .94 > 0 }
      }
      for (let line = 0; line < 28; line++) {
        ctx.beginPath()
        let connected = false
        for (let step = 0; step <= 72; step++) {
          const meridian = line < 20
          const latitude = meridian ? -Math.PI / 2 + step / 72 * Math.PI : -1.42 + (line - 20) * .19
          const longitude = meridian ? line / 20 * Math.PI * 2 + time * .045 : step / 72 * Math.PI * 2
          const point = spherePoint(latitude, longitude)
          if (point.visible) {
            if (connected) ctx.lineTo(point.x, point.y)
            else ctx.moveTo(point.x, point.y)
          }
          connected = point.visible
        }
        ctx.stroke()
      }
      ctx.restore()
      const sweep = Math.PI * 1.5 + Math.sin(time * .2) * .65
      for (let segment = 0; segment < 12; segment++) {
        const angle = sweep + (segment / 12 - .5) * .28
        for (const [thickness, opacity] of [[20, .035], [8, .09], [1.5, .6]]) {
          ctx.strokeStyle = '#b7e6f0'
          ctx.globalAlpha = opacity! * Math.sin(segment / 11 * Math.PI)
          ctx.lineWidth = thickness!
          ctx.beginPath()
          ctx.arc(width / 2, centerY, radius, angle, angle + .025)
          ctx.stroke()
        }
      }
      ctx.restore()

      // 整屏光带缓慢穿行；入口聚焦时只弯曲光流，不移动真实导航。
      ctx.save()
      ctx.globalCompositeOperation = 'screen'
      const tint = sun.twilight > .5 ? '219,178,137' : '115,191,216'
      const wash = ctx.createRadialGradient(width * (.5 + Math.sin(time * .19) * .3), height * .48, 0, width * .5, height * .55, width * .6)
      wash.addColorStop(0, `rgba(${tint},.08)`)
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
      paintScene()
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
      delete host.dataset.ready
    }
  }, [minute, paused])
  return <div className="home-cosmos" aria-hidden="true" style={{ '--solar-position': `${50 - Math.cos(light.angle) * 43}%` } as CSSProperties}><canvas ref={canvasRef} /></div>
}
