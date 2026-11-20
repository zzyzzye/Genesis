import { useEffect, useRef } from 'react'

const palette = ['#d8b995', '#a4dce5', '#d6c5e5']

/** 星轨只负责氛围与指向，业务导航始终由原生链接承担。 */
export function GenesisUniverse({ active, paused }: { active: number | null; paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elapsed = useRef(0)
  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    const stage = host?.parentElement
    if (!canvas || !host || !stage) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    host.dataset.ready = 'true'
    let width = 0, height = 0, frame = 0, last = 0
    let visible = true
    let pointerX = 0, pointerY = 0, offsetX = 0, offsetY = 0
    let destinations: { x: number; y: number }[] = []
    const stars = Array.from({ length: 170 }, (_, i) => ({ x: (i * .6180339) % 1, y: (i * .4142135) % 1, size: i % 9 === 0 ? 1.5 : .6, alpha: .15 + (i % 5) * .1 }))

    function draw(delta = 0) {
      if (!ctx) return
      elapsed.current += delta * .000025
      const time = elapsed.current
      const ease = 1 - Math.exp(-delta / 240)
      offsetX += (pointerX - offsetX) * ease
      offsetY += (pointerY - offsetY) * ease
      const cx = width * .5 + offsetX
      const cy = height * .49 + offsetY
      const radius = Math.min(width * .44, 650)
      ctx.clearRect(0, 0, width, height)
      for (const star of stars) {
        ctx.globalAlpha = star.alpha
        ctx.fillStyle = '#d9dfe3'
        ctx.fillRect(star.x * width + offsetX * star.size, star.y * height + offsetY * star.size, star.size, star.size)
      }
      // 少量椭圆与有界粒子构成空间层次，避免逐帧创建滤镜和发光阴影。
      for (let orbit = 0; orbit < 3; orbit++) {
        const angle = -.28 + orbit * .24
        const r = radius * (1 - orbit * .17)
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(angle)
        ctx.strokeStyle = palette[orbit]!
        ctx.globalAlpha = active === orbit ? .48 : .16
        ctx.lineWidth = .7
        ctx.beginPath()
        ctx.ellipse(0, 0, r, r * .35, 0, 0, Math.PI * 2)
        ctx.stroke()
        for (let i = 0; i < 220; i++) {
          const a = i / 220 * Math.PI * 2 + time * (orbit % 2 ? -1 : 1)
          const spread = Math.sin(i * 12.7) * 8
          ctx.globalAlpha = (active === orbit ? .7 : .32) * (.3 + .7 * (Math.sin(a) + 1) / 2)
          ctx.fillStyle = palette[orbit]!
          ctx.fillRect(Math.cos(a) * (r + spread), Math.sin(a) * (r * .35 + spread), i % 17 === 0 ? 2 : 1, i % 17 === 0 ? 2 : 1)
        }
        const comet = time * 1.3 + orbit * 2.1
        ctx.globalAlpha = .9
        ctx.beginPath()
        ctx.ellipse(0, 0, r, r * .35, 0, comet, comet + .06)
        ctx.stroke()
        ctx.restore()
      }
      const destination = active === null ? null : destinations[active]
      if (destination && width > 760) {
        ctx.strokeStyle = palette[active!]!
        ctx.globalAlpha = .25
        ctx.lineWidth = .8
        ctx.setLineDash([2, 7])
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.quadraticCurveTo(cx, destination.y, destination.x, destination.y)
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.globalAlpha = .8
      ctx.fillStyle = '#f1e9df'
      ctx.fillRect(cx - 8, cy, 17, 1)
      ctx.fillRect(cx, cy - 8, 1, 17)
      ctx.globalAlpha = 1
    }
    function tick(now: number) {
      const delta = last ? Math.min(now - last, 40) : 16
      last = now
      draw(delta)
      frame = requestAnimationFrame(tick)
    }
    function sync() {
      cancelAnimationFrame(frame)
      last = 0
      if (!document.hidden && visible) {
        draw()
        if (!paused) frame = requestAnimationFrame(tick)
      }
    }
    function resize() {
      if (!canvas || !host || !ctx || !stage) return
      width = host.clientWidth
      height = host.clientHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      const origin = host.getBoundingClientRect()
      destinations = Array.from(stage.querySelectorAll('.home-portal-art'), element => {
        const rect = element.getBoundingClientRect()
        return { x: rect.x + rect.width / 2 - origin.x, y: rect.y + rect.height / 2 - origin.y }
      })
      draw()
    }
    function move(event: PointerEvent) {
      if (paused || event.pointerType !== 'mouse' || !stage) return
      const rect = stage.getBoundingClientRect()
      pointerX = ((event.clientX - rect.left) / rect.width - .5) * 24
      pointerY = ((event.clientY - rect.top) / rect.height - .5) * 18
    }
    function leave() { pointerX = 0; pointerY = 0 }
    const resizeObserver = new ResizeObserver(resize)
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync() })
    resizeObserver.observe(host)
    observer.observe(host)
    stage.addEventListener('pointermove', move, { passive: true })
    stage.addEventListener('pointerleave', leave)
    document.addEventListener('visibilitychange', sync)
    resize()
    sync()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      observer.disconnect()
      stage.removeEventListener('pointermove', move)
      stage.removeEventListener('pointerleave', leave)
      document.removeEventListener('visibilitychange', sync)
      delete host.dataset.ready
    }
  }, [active, paused])
  return <div className="home-cosmos" aria-hidden="true"><canvas ref={canvasRef} /></div>
}
