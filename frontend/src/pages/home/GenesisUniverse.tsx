import { useEffect, useRef, type CSSProperties } from 'react'
import { solarScene } from './solarScene'

/** 地平线光场按本地时刻变化；地表是程序纹理，不请求定位或外部地图。 */
export function GenesisUniverse({ minute, paused }: { minute: number; paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elapsed = useRef(0)
  const light = solarScene(minute)
  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scene = document.createElement('canvas')
    const background = scene.getContext('2d')
    if (!background) return
    host.dataset.ready = 'true'
    let width = 0, height = 0, frame = 0, last = 0, radius = 0, centerY = 0
    let visible = true
    const sun = solarScene(minute)

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
      elapsed.current += delta * .00006
      const time = elapsed.current
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(scene, 0, 0, width, height)
      // 巨大的曲面网格缓慢流动，让地球尺度可感知；不会遮挡操作或抢占滚轮。
      ctx.save()
      ctx.beginPath()
      ctx.arc(width / 2, centerY, radius - 3, 0, Math.PI * 2)
      ctx.clip()
      ctx.strokeStyle = '#8ec5e0'
      ctx.lineWidth = .6
      ctx.globalAlpha = .06 + sun.daylight * .05
      for (let i = 0; i < 11; i++) {
        const shift = Math.sin(time + i * .28) * width * .012
        const offset = (i - 5) * width * .12
        ctx.beginPath()
        ctx.moveTo(width / 2 + offset * .18 + shift, height * .55)
        ctx.quadraticCurveTo(width / 2 + offset * .65 + shift, height * .8, width / 2 + offset * 1.8, height * 1.12)
        ctx.stroke()
      }
      for (let i = 1; i < 6; i++) {
        ctx.beginPath()
        ctx.ellipse(width / 2, centerY, radius - i * 24, radius - i * 18, 0, 0, Math.PI * 2)
        ctx.stroke()
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
      draw()
    }
    const resizeObserver = new ResizeObserver(resize)
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync() })
    resizeObserver.observe(host)
    observer.observe(host)
    document.addEventListener('visibilitychange', sync)
    resize()
    sync()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      observer.disconnect()
      document.removeEventListener('visibilitychange', sync)
      delete host.dataset.ready
    }
  }, [minute, paused])
  return <div className="home-cosmos" aria-hidden="true" style={{ '--solar-position': `${50 - Math.cos(light.angle) * 43}%` } as CSSProperties}><canvas ref={canvasRef} /></div>
}
