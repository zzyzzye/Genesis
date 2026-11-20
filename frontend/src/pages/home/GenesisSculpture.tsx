import { useEffect, useRef } from 'react'

type Point = { x: number; y: number; z: number; sx: number; sy: number; sz: number; color: string }

/** 只在首页生成有界的装饰点集，不引入三维引擎或外部素材请求。 */
function createPoints(count: number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const u = Math.floor(index / 24) / (count / 24) * Math.PI * 2
    const v = index % 24 / 24 * Math.PI * 2
    const radius = 1.75 + .55 * Math.cos(3 * u)
    const latitude = Math.acos(1 - 2 * (index + .5) / count)
    const longitude = index * 2.3999632297
    return {
      x: (radius + .24 * Math.cos(v)) * Math.cos(2 * u),
      y: (radius + .24 * Math.cos(v)) * Math.sin(2 * u),
      z: .8 * Math.sin(3 * u) + .24 * Math.sin(v),
      sx: 1.8 * Math.sin(latitude) * Math.cos(longitude),
      sy: 1.8 * Math.sin(latitude) * Math.sin(longitude),
      sz: 1.8 * Math.cos(latitude),
      color: Math.sin(u + v) > .45 ? '#d8bda2' : Math.cos(v) > .1 ? '#dce9ec' : '#86b8c7',
    }
  })
}

export function GenesisSculpture({ form, paused }: { form: 0 | 1; paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scene = useRef({ time: 0, morph: 0, x: 0, y: 0 })
  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!canvas || !host) return
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) return
    host.dataset.ready = 'true'
    const points = createPoints(window.innerWidth < 680 ? 2880 : 5280)
    const state = scene.current
    let width = 0, height = 0, frame = 0, last = 0
    let visible = true
    let targetX = 0, targetY = 0
    function draw(delta = 0) {
      if (!context || !canvas) return
      state.time += delta * .00012
      const ease = 1 - Math.exp(-delta / 210)
      state.morph = paused ? form : state.morph + (form - state.morph) * ease
      state.x += (targetX - state.x) * ease
      state.y += (targetY - state.y) * ease
      context.clearRect(0, 0, width, height)
      const angle = state.time + .2 + state.x
      const tilt = .85 + state.y
      const ca = Math.cos(angle), sa = Math.sin(angle), ct = Math.cos(tilt), st = Math.sin(tilt)
      const scale = Math.min(width / 6.3, height / 5.5)
      // 每帧只投影点，不测量布局、不更新 React 状态；像素比限制为 1.5。
      for (const point of points) {
        const x = point.x + (point.sx - point.x) * state.morph
        const y = point.y + (point.sy - point.y) * state.morph
        const z = point.z + (point.sz - point.z) * state.morph
        const rx = x * ca - y * sa
        const ry = x * sa + y * ca
        const depth = ry * st + z * ct
        const perspective = 7 / (7 - depth)
        const px = width / 2 + rx * scale * perspective
        const py = height / 2 + (ry * ct - z * st) * scale * perspective
        const size = Math.max(.6, (depth + 4) * .33) * perspective
        context.globalAlpha = Math.min(.95, Math.max(.16, (depth + 3) / 6))
        context.fillStyle = point.color
        context.fillRect(px, py, size, size)
      }
      context.globalAlpha = 1
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
      if (!canvas || !host || !context) return
      width = host.clientWidth
      height = host.clientHeight
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      draw()
    }
    function move(event: PointerEvent) {
      if (paused || event.pointerType !== 'mouse' || !host) return
      const rect = host.getBoundingClientRect()
      targetX = ((event.clientX - rect.left) / rect.width - .5) * .65
      targetY = ((event.clientY - rect.top) / rect.height - .5) * .45
    }
    function leave() { targetX = 0; targetY = 0 }
    const resizeObserver = new ResizeObserver(resize)
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync() })
    resizeObserver.observe(host)
    observer.observe(host)
    host.addEventListener('pointermove', move, { passive: true })
    host.addEventListener('pointerleave', leave)
    document.addEventListener('visibilitychange', sync)
    resize()
    sync()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      observer.disconnect()
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerleave', leave)
      document.removeEventListener('visibilitychange', sync)
      delete host.dataset.ready
    }
  }, [form, paused])
  return <div className="home-art" aria-hidden="true">
    <svg className="home-art-fallback" viewBox="0 0 600 500" fill="none">
      {form === 0 ? [0, 60, 120].map(angle => <ellipse key={angle} cx="300" cy="250" rx="190" ry="85" transform={`rotate(${angle} 300 250)`} stroke="currentColor" strokeWidth="2" strokeDasharray="1 5" />) : [45, 100, 150, 190].map(radius => <ellipse key={radius} cx="300" cy="250" rx={radius} ry="190" stroke="currentColor" strokeWidth="2" strokeDasharray="1 5" />)}
    </svg>
    <canvas ref={canvasRef} />
  </div>
}
