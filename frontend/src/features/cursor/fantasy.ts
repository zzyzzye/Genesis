export type FantasyTheme = 'quill' | 'starlight' | 'dragon'
export type CursorPoint = { x: number; y: number; born: number }
type FantasyFrame = {
  x: number; y: number; time: number; speed: number; hovering: boolean; pressed: boolean
  reduced: boolean; pulse: number; pulseX: number; pulseY: number
  samples: CursorPoint[]; body: { x: number; y: number }[]
}

const palette = { ink: '#263847', pearl: '#f7f5e9', gold: '#f0c56a', teal: '#45bdae', violet: '#9477da', blue: '#75d5eb', flame: '#ed9954' }

export function isFantasyTheme(theme: string): theme is FantasyTheme {
  return theme === 'quill' || theme === 'starlight' || theme === 'dragon'
}

function spark(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4, r = i % 2 ? radius * .25 : radius
    const px = x + Math.cos(angle) * r, py = y + Math.sin(angle) * r
    if (i) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
  }
  ctx.closePath(); ctx.fill()
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill()
}

function drawQuill(ctx: CanvasRenderingContext2D, f: FantasyFrame) {
  ctx.save()
  ctx.translate(f.x, f.y)
  ctx.rotate(f.reduced ? 0 : Math.sin(f.speed / 16) * .1)
  const fill = ctx.createLinearGradient(2, -3, 25, -38)
  fill.addColorStop(0, palette.blue); fill.addColorStop(.55, palette.violet); fill.addColorStop(1, palette.pearl)
  ctx.fillStyle = fill; ctx.strokeStyle = palette.ink; ctx.lineWidth = .7
  ctx.beginPath(); ctx.moveTo(3, -5)
  ctx.bezierCurveTo(-1, -23, 11, -39, 28, -41)
  ctx.bezierCurveTo(32, -26, 22, -7, 3, -5)
  ctx.fill(); ctx.stroke()
  // 羽轴终点就是实际命中位置，不让装饰改变点击坐标。
  ctx.strokeStyle = f.hovering ? palette.gold : palette.pearl; ctx.lineWidth = 1.3
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(9, -20, 26, -38); ctx.stroke()
  ctx.strokeStyle = 'rgba(247,245,233,.65)'; ctx.lineWidth = .65
  for (let i = 0; i < 6; i++) {
    const y = -10 - i * 4, x = 5 + i * 2.5
    ctx.beginPath(); ctx.moveTo(x - 4, y - 8); ctx.lineTo(x, y); ctx.lineTo(x + 10 - i, y - 2); ctx.stroke()
  }
  ctx.fillStyle = palette.gold; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2, -8); ctx.lineTo(6, -5); ctx.closePath(); ctx.fill()
  ctx.restore()
}

function drawStar(ctx: CanvasRenderingContext2D, f: FantasyFrame) {
  ctx.save(); ctx.translate(f.x, f.y)
  const angle = f.reduced ? -.4 : -.4 + f.speed * .012
  ctx.rotate(angle)
  ctx.strokeStyle = palette.violet; ctx.lineWidth = 1
  ctx.beginPath(); ctx.ellipse(0, 0, f.hovering ? 22 : 17, 6, -.3, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = palette.blue
  ctx.beginPath(); ctx.ellipse(0, 0, 7, f.hovering ? 21 : 16, -.55, 0, Math.PI * 2); ctx.stroke()
  ctx.strokeStyle = palette.ink; ctx.lineWidth = .8
  spark(ctx, 0, 0, f.pressed ? 6 : 11, palette.gold); ctx.stroke()
  spark(ctx, 0, 0, 5, palette.pearl)
  ctx.fillStyle = palette.pearl; circle(ctx, 16, -5, 2); ctx.stroke()
  ctx.restore()
}

function drawDragon(ctx: CanvasRenderingContext2D, f: FantasyFrame) {
  const body = f.body
  // 身体在头部后方逐节追随；减少动态效果时绘制固定的小龙轮廓。
  for (let i = body.length - 1; i > 0; i--) {
    const p = body[i], next = body[i - 1], t = i / body.length
    if (!p || !next) continue
    ctx.strokeStyle = palette.ink; ctx.lineWidth = Math.max(1, 9 * (1 - t)) + 1.5; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(next.x, next.y); ctx.stroke()
    ctx.strokeStyle = i % 3 === 0 ? palette.gold : palette.teal; ctx.lineWidth -= 1.5; ctx.stroke()
    if (i % 3 === 0) spark(ctx, p.x + 2, p.y - 4, 2.7 * (1 - t), palette.gold)
  }
  const neck = body[1] ?? { x: f.x - 7, y: f.y + 7 }
  const angle = Math.atan2(f.y - neck.y, f.x - neck.x)
  ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(angle)
  ctx.strokeStyle = palette.gold; ctx.lineWidth = 1.5
  const horns = f.hovering ? 13 : 9
  for (const side of [-1, 1]) {
    ctx.beginPath(); ctx.moveTo(-4, side * 4); ctx.lineTo(-10, side * horns); ctx.lineTo(-7, side * (horns + 2)); ctx.stroke()
    ctx.strokeStyle = palette.teal; ctx.lineWidth = .8
    ctx.beginPath(); ctx.moveTo(3, side * 3); ctx.quadraticCurveTo(12, side * 13, 16, side * 7); ctx.stroke()
    ctx.strokeStyle = palette.gold; ctx.lineWidth = 1.5
  }
  ctx.fillStyle = palette.teal; ctx.strokeStyle = palette.ink; ctx.lineWidth = .8
  ctx.beginPath(); ctx.ellipse(-1, 0, 8, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.fillStyle = palette.pearl
  circle(ctx, 1, -3, 2); circle(ctx, 1, 3, 2)
  ctx.fillStyle = palette.ink; circle(ctx, 2, -3, .9); circle(ctx, 2, 3, .9)
  ctx.fillStyle = palette.gold; ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(-8, -3); ctx.lineTo(-10, 0); ctx.lineTo(-8, 3); ctx.closePath(); ctx.fill()
  ctx.restore()
}

export function drawFantasyCursor(ctx: CanvasRenderingContext2D, theme: FantasyTheme, f: FantasyFrame) {
  ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (!f.reduced && theme !== 'dragon') f.samples.forEach((p, i) => {
    const age = (f.time - p.born) / 700
    ctx.globalAlpha = Math.max(0, (1 - age) * .65)
    spark(ctx, p.x + Math.sin(i * 2.4) * 5, p.y + Math.cos(i * 1.7) * 5, 1.5 + (i % 3), i % 2 ? palette.gold : palette.violet)
  })
  ctx.globalAlpha = 1
  if (theme === 'quill') drawQuill(ctx, f)
  else if (theme === 'starlight') drawStar(ctx, f)
  else drawDragon(ctx, f)
  const progress = (f.time - f.pulse) / 700
  if (!f.reduced && f.pulse > 0 && progress >= 0 && progress < 1) {
    ctx.save(); ctx.translate(f.pulseX, f.pulseY); ctx.globalAlpha = 1 - progress
    if (theme === 'quill') {
      ctx.rotate(progress * .6); ctx.strokeStyle = palette.violet; ctx.lineWidth = 1
      const radius = 12 + progress * 23
      ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke()
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3
        ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(radius - 3, -3); ctx.lineTo(radius + 3, 0); ctx.lineTo(radius - 3, 3); ctx.stroke(); ctx.restore()
      }
      spark(ctx, 0, 0, 8 + progress * 5, palette.gold)
    } else if (theme === 'starlight') {
      const points: [number, number][] = [[-25,-14],[-7,-30],[17,-19],[29,6],[6,26],[-18,17]]
      ctx.strokeStyle = palette.violet; ctx.lineWidth = .8; ctx.beginPath()
      points.forEach(([x,y],i)=>{ const scale=.5+progress; if(i)ctx.lineTo(x*scale,y*scale);else ctx.moveTo(x*scale,y*scale) });ctx.stroke()
      points.forEach(([x,y],i)=>spark(ctx,x*(.5+progress),y*(.5+progress),i%2?3:4,palette.gold))
    } else {
      for (let i = 0; i < 9; i++) {
        const a = -.7 + i * .2, r = 9 + progress * (22 + i % 3 * 7)
        spark(ctx, Math.cos(a) * r, Math.sin(a) * r, (1 - progress) * 4 + 1, i % 2 ? palette.gold : palette.flame)
      }
    }
    ctx.restore()
  }
  ctx.restore()
}
