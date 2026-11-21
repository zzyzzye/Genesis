/** 星点复用离屏天空缓存，不随每帧重新生成。 */
export function paintStarfield(ctx: CanvasRenderingContext2D, width: number, height: number, daylight: number) {
  const compact = width <= 760
  const visibility = 1 - daylight * .58
  const random = (seed: number) => {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
    return value - Math.floor(value)
  }

  ctx.save()
  const count = Math.min(240, Math.round(width * height / 5000))
  for (let i = 0; i < count; i++) {
    const x = random(i + 1) * width
    const y = 85 + random(i + 401) * Math.max(0, height * .72 - 85)
    // 文案附近保留安静的留白，星点只作远景，不形成均匀网格。
    const behindCopy = compact ? y < 215 : x > width * .3 && x < width * .7 && y < height * .3
    const bright = i % 19 === 0 && !behindCopy
    const radius = bright ? .95 : .35 + random(i + 801) * .4
    ctx.globalAlpha = (.25 + random(i + 1201) * .5) * visibility * (behindCopy ? .25 : 1)
    ctx.fillStyle = i % 5 === 0 ? '#e4d6bf' : '#d9e6f4'
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    if (bright) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 4)
      glow.addColorStop(0, 'rgba(217,230,244,.35)')
      glow.addColorStop(1, 'rgba(217,230,244,0)')
      ctx.fillStyle = glow
      ctx.fillRect(x - 4, y - 4, 8, 8)
    }
  }
  ctx.restore()
}
