type Point3 = { x: number; y: number; z: number }
type Point2 = { x: number; y: number }

export const RIBBON_FISH_DURATION = 22

// 六条弧线分别连接左右、顶部和底部留白；镜像后提供另一侧的进出位置。
export const RIBBON_FISH_ROUTES: readonly (readonly [Point2, Point2, Point2, Point2])[] = [
  [{ x: -.22, y: .76 }, { x: .12, y: .67 }, { x: .62, y: .19 }, { x: 1.2, y: .42 }],
  [{ x: -.22, y: .32 }, { x: .18, y: .36 }, { x: .66, y: .76 }, { x: 1.2, y: .66 }],
  [{ x: -.22, y: .46 }, { x: .23, y: .32 }, { x: .68, y: .62 }, { x: .88, y: 1.2 }],
  [{ x: .12, y: 1.2 }, { x: .24, y: .65 }, { x: .64, y: .31 }, { x: 1.2, y: .48 }],
  [{ x: .08, y: -.22 }, { x: .12, y: .4 }, { x: .66, y: .64 }, { x: 1.2, y: .58 }],
  [{ x: -.22, y: .7 }, { x: .35, y: .69 }, { x: .88, y: .41 }, { x: .94, y: -.22 }],
]

/** 每轮只抽取一次航线，排除上一条，暂停、调整时间和缩放时保持当前航线。 */
export function nextRibbonFishRoute(previous: number, sample: number) {
  const count = RIBBON_FISH_ROUTES.length
  const choice = Math.min(1 - Number.EPSILON, Math.max(0, sample))
  return previous < 0 ? Math.floor(choice * count) : (previous + 1 + Math.floor(choice * (count - 1))) % count
}

/** 弧线航迹、俯仰和远近共用同一个进度，身体朝向始终跟随航迹切线。 */
export function ribbonFishPose(width: number, height: number, progress: number, direction: number, route = 0) {
  if (progress <= 0 || progress >= 1) return null
  const p = progress
  const q = 1 - p
  const [a, b, c, d] = RIBBON_FISH_ROUTES[route] ?? RIBBON_FISH_ROUTES[0]!
  const x = q ** 3 * a.x + 3 * q * q * p * b.x + 3 * q * p * p * c.x + p ** 3 * d.x
  const y = q ** 3 * a.y + 3 * q * q * p * b.y + 3 * q * p * p * c.y + p ** 3 * d.y
  const dx = 3 * q * q * (b.x - a.x) + 6 * q * p * (c.x - b.x) + 3 * p * p * (d.x - c.x)
  const dy = 3 * q * q * (b.y - a.y) + 6 * q * p * (c.y - b.y) + 3 * p * p * (d.y - c.y)
  const fade = Math.min(1, p / .2, (1 - p) / .24)
  return {
    x: (direction > 0 ? x : 1 - x) * width,
    y: y * height,
    length: Math.min(560, width * (width > 760 ? .36 : .8)) * (.72 + .28 * Math.sin(p * Math.PI)),
    pitch: Math.atan2(dy * height, dx * width),
    yaw: .55 * Math.sin(p * Math.PI * 1.7 - .65),
    roll: -.5 + .32 * Math.sin(p * Math.PI * 2 - .5),
    phase: p * Math.PI * 8,
    opacity: fade * fade * (3 - 2 * fade),
    direction,
  }
}

type FishPose = NonNullable<ReturnType<typeof ribbonFishPose>>

function bezier(a: Point3, b: Point3, c: Point3, d: Point3, t: number): Point3 {
  const s = 1 - t
  return {
    x: s ** 3 * a.x + 3 * s * s * t * b.x + 3 * s * t * t * c.x + t ** 3 * d.x,
    y: s ** 3 * a.y + 3 * s * s * t * b.y + 3 * s * t * t * c.y + t ** 3 * d.y,
    z: s ** 3 * a.z + 3 * s * s * t * b.z + 3 * s * t * t * c.z + t ** 3 * d.z,
  }
}

// 尾柄、腹部、肩部、额头的截面分别控制，避免梭形轮廓与尖头。
const sections = [
  [-.54, .016], [-.42, .027], [-.29, .055], [-.13, .098],
  [.05, .127], [.23, .125], [.38, .103], [.47, .066], [.505, .025], [.51, 0],
] as const

function bodyRadius(x: number) {
  let i = 0
  while (i < sections.length - 2 && x > sections[i + 1]![0]) i++
  const left = sections[i]!
  const right = sections[i + 1]!
  const t = Math.max(0, Math.min(1, (x - left[0]) / (right[0] - left[0])))
  const previous = sections[Math.max(0, i - 1)]!
  const next = sections[Math.min(sections.length - 1, i + 2)]!
  const m0 = (right[1] - previous[1]) / (right[0] - previous[0]) * (right[0] - left[0])
  const m1 = (next[1] - left[1]) / (next[0] - left[0]) * (right[0] - left[0])
  return Math.max(0, (2 * t ** 3 - 3 * t * t + 1) * left[1] + (t ** 3 - 2 * t * t + t) * m0 + (-2 * t ** 3 + 3 * t * t) * right[1] + (t ** 3 - t * t) * m1)
}

/** 以立体截面和连续脊线绘制鱼影；鳍与尾柄共享形变，转身时可见侧面变化。 */
export function paintRibbonFish(ctx: CanvasRenderingContext2D, pose: FishPose | null, tint: string) {
  if (!pose) return
  const { length, phase, direction, opacity, x: centerX, y: centerY } = pose
  const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll)
  const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw)
  const cp = Math.cos(pose.pitch), sp = Math.sin(pose.pitch)

  function project(point: Point3): Point2 {
    const tailWeight = Math.max(0, (.51 - point.x) / 1.05)
    // 摆动沿脊线向后传递，额头稳定、尾柄振幅较大，鳍自然跟随连接点。
    const bend = Math.sin(phase - tailWeight * 4.5) * (.004 + .065 * tailWeight ** 2)
    const y = point.y + bend
    const z = point.z + Math.sin(phase * .5 - tailWeight * 2) * .016 * tailWeight ** 2
    const rolledY = y * cr - z * sr
    const rolledZ = y * sr + z * cr
    const yawedX = point.x * cy + rolledZ * sy
    const depth = -point.x * sy + rolledZ * cy
    const perspective = 1 / (1 - depth * .35)
    return {
      x: centerX + (yawedX * cp - rolledY * sp) * length * perspective * direction,
      y: centerY + (yawedX * sp + rolledY * cp) * length * perspective,
    }
  }

  function stroke(points: Point3[], alpha: number, thickness = .7) {
    ctx.globalAlpha = opacity * alpha
    ctx.lineWidth = thickness
    ctx.beginPath()
    for (const [i, point] of points.entries()) {
      const p = project(point)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
  }

  function fin(leading: [Point3, Point3, Point3, Point3], trailing: [Point3, Point3, Point3, Point3], alpha: number) {
    for (let line = 0; line <= 7; line++) {
      const mix = line / 7
      const points: Point3[] = []
      for (let step = 0; step <= 28; step++) {
        const t = step / 28
        const a = bezier(...leading, t)
        const b = bezier(...trailing, t)
        points.push({ x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix, z: a.z + (b.z - a.z) * mix })
      }
      stroke(points, alpha * (line === 0 || line === 7 ? 1 : .5))
    }
  }

  ctx.save()
  const tail = project({ x: -.72, y: 0, z: 0 })
  const head = project({ x: .51, y: 0, z: 0 })
  const light = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y)
  light.addColorStop(0, `rgba(${tint},.52)`)
  light.addColorStop(.3, `rgba(${tint},.35)`)
  light.addColorStop(.55, `rgba(${tint},.16)`)
  light.addColorStop(.85, `rgba(${tint},.35)`)
  light.addColorStop(1, `rgba(${tint},.5)`)
  ctx.strokeStyle = light
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  function flipper(side: number) {
    const flutter = Math.sin(phase * .65 + side) * .022
    fin(
      [{ x: .22, y: .055, z: side * .075 }, { x: .1, y: .11, z: side * .17 }, { x: -.05, y: .2 + flutter, z: side * .33 }, { x: -.24, y: .17 + flutter, z: side * .38 }],
      [{ x: .06, y: .085, z: side * .08 }, { x: -.03, y: .15, z: side * .16 }, { x: -.13, y: .2 + flutter, z: side * .3 }, { x: -.24, y: .17 + flutter, z: side * .38 }],
      side < 0 ? .28 : .65,
    )
  }

  flipper(-1)
  // 横向展开的柔软尾叶有弧形前缘与尾叉，避免三角形折纸尾巴。
  for (const side of [-1, 1]) {
    const curl = Math.sin(phase - 4.5) * .035
    fin(
      [{ x: -.52, y: 0, z: 0 }, { x: -.53, y: -.02, z: side * .12 }, { x: -.58, y: curl, z: side * .23 }, { x: -.72, y: curl + .025, z: side * .27 }],
      [{ x: -.63, y: .008, z: 0 }, { x: -.65, y: .015, z: side * .12 }, { x: -.77, y: curl + .04, z: side * .22 }, { x: -.72, y: curl + .025, z: side * .27 }],
      side < 0 ? .38 : .75,
    )
  }

  // 只强调朝向观察者的经线，背面略隐去，转身时呈现体积变化。
  for (let line = 0; line < 24; line++) {
    const angle = line / 24 * Math.PI * 2
    const facing = Math.sin(angle + pose.roll)
    const points: Point3[] = []
    for (let step = 0; step <= 72; step++) {
      const x = -.54 + step / 72 * 1.05
      const r = bodyRadius(x)
      const vertical = Math.cos(angle)
      points.push({ x, y: r * vertical * (vertical > 0 ? 1 : .78), z: r * .82 * Math.sin(angle) })
    }
    const silhouette = Math.abs(facing) < .2
    stroke(points, silhouette ? .78 : facing > 0 ? .32 + .35 * facing : .1, silhouette ? .9 : .7)
  }

  // 少量横向曲线交代头部与肩部的圆润形体，密度低于主光带。
  for (const x of [-.35, -.18, .02, .19, .33, .43, .48]) {
    const r = bodyRadius(x)
    const points: Point3[] = []
    for (let step = 0; step <= 32; step++) {
      const angle = step / 32 * Math.PI - pose.roll
      const vertical = Math.cos(angle)
      points.push({ x, y: r * vertical * (vertical > 0 ? 1 : .78), z: r * .82 * Math.sin(angle) })
    }
    stroke(points, .16)
  }

  fin(
    [{ x: -.06, y: -.09, z: 0 }, { x: -.09, y: -.12, z: 0 }, { x: -.17, y: -.22, z: 0 }, { x: -.22, y: -.2, z: 0 }],
    [{ x: -.3, y: -.04, z: 0 }, { x: -.22, y: -.065, z: 0 }, { x: -.19, y: -.15, z: 0 }, { x: -.22, y: -.2, z: 0 }],
    .45,
  )
  flipper(1)
  ctx.restore()
}
