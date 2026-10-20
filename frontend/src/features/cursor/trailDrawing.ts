import type { CursorTrailStyle } from './preferences'

export type TrailPoint = { x: number; y: number; born: number }

export function drawTrail(ctx: CanvasRenderingContext2D, style: CursorTrailStyle, points: TrailPoint[], now: number) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  points.forEach((p, i) => {
    const age = Math.max(0, Math.min(1, (now - p.born) / 620))
    ctx.globalAlpha = (1 - age) * .7
    ctx.strokeStyle = '#8e79b9'; ctx.fillStyle = i % 2 ? '#b78b42' : '#967ac2'
    if (style === 'silk') {
      const before = points[i - 1]
      if (!before) return
      ctx.lineWidth = Math.max(.4, (1 - age) * 2.4)
      ctx.beginPath(); ctx.moveTo(before.x, before.y); ctx.lineTo(p.x, p.y); ctx.stroke()
      ctx.globalAlpha *= .3; ctx.lineWidth = .8
      ctx.beginPath(); ctx.moveTo(before.x, before.y + 4); ctx.lineTo(p.x, p.y + 4); ctx.stroke()
    } else if (style === 'dust') {
      const x = p.x + Math.sin(i * 2.4) * age * 12, y = p.y + Math.cos(i * 1.7) * age * 12
      const radius = (1 - age) * (i % 3 + 1)
      ctx.beginPath()
      for (let n = 0; n < 8; n++) {
        const a = n * Math.PI / 4, r = n % 2 ? radius * .25 : radius
        if (n) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
        else ctx.moveTo(x + r, y)
      }
      ctx.closePath(); ctx.fill()
    } else if (style === 'ripple' && i % 3 === 0) {
      ctx.lineWidth = .8; ctx.beginPath(); ctx.arc(p.x, p.y, 2 + age * 13, 0, Math.PI * 2); ctx.stroke()
    }
  })
  ctx.restore()
}
