import earthLand from './earthLand.json'
import type { solarScene } from './solarScene'

type Sunlight = ReturnType<typeof solarScene>

/** 将本地海岸线栅格化一次；球体旋转只采样纹理，不重复请求地图。 */
function earthAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#103753'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#638f80'
  ctx.strokeStyle = '#9db9a7'
  ctx.lineWidth = .7
  for (const polygon of earthLand) {
    ctx.beginPath()
    for (const ring of polygon) {
      ring.forEach(([longitude, latitude], index) => {
        const x = (longitude! + 180) / 360 * canvas.width
        const y = (90 - latitude!) / 180 * canvas.height
        if (index === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.closePath()
    }
    ctx.fill('evenodd')
    ctx.stroke()
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < canvas.height; y++) {
    const latitude = 90 - y / canvas.height * 180
    for (let x = 0; x < canvas.width; x++) {
      const index = (y * canvas.width + x) * 4
      const longitude = x / canvas.width * 360 - 180
      const land = pixels.data[index]! > 60
      // 沙漠与极地仅作自然色提示，不表达行政边界或精确生态分区。
      const desert = land ? Math.exp(-Math.pow((latitude - 24) / 10, 2) - Math.pow((longitude - 22) / 48, 4)) * .65 : 0
      const ice = Math.max(0, Math.min(1, (Math.abs(latitude) - 65) / 12)) * (land ? .85 : .2)
      const cloud = Math.max(0, Math.sin(x * .018 + Math.sin(y * .025) * 3) * Math.sin(y * .046 + Math.cos(x * .012) * 2) - .55) * .28
      const veil = Math.max(ice, cloud)
      pixels.data[index] = (pixels.data[index]! + desert * 90) * (1 - veil) + 200 * veil
      pixels.data[index + 1] = (pixels.data[index + 1]! + desert * 25) * (1 - veil) + 216 * veil
      pixels.data[index + 2] = (pixels.data[index + 2]! - desert * 18) * (1 - veil) + 216 * veil
    }
  }
  return pixels.data
}

/** 独立球体缓冲：预计算球面坐标，按相同太阳方向绘制地球和月球。 */
export function createCelestialBodies() {
  const atlas = earthAtlas()
  const earth = document.createElement('canvas')
  const surface = earth.getContext('2d')
  const moon = document.createElement('canvas')
  moon.width = moon.height = 112
  const lunarSurface = moon.getContext('2d')
  if (!atlas || !surface || !lunarSurface) return null
  let size = 0
  let compact = false
  let pixels = surface.createImageData(1, 1)
  let geometry = new Float32Array(0)
  const lunarPixels = lunarSurface.createImageData(112, 112)
  const lunarGeometry = new Float32Array(112 * 112 * 4)
  const craters = [[-.32, -.3, .27], [.35, .24, .32], [.17, -.48, .16], [-.45, .38, .2], [.58, -.35, .12], [-.08, .63, .12], [-.04, -.02, .15]]
  for (let y = 0; y < 112; y++) {
    for (let x = 0; x < 112; x++) {
      const nx = (x + .5) / 56 - 1
      const ny = (y + .5) / 56 - 1
      const squared = nx * nx + ny * ny
      if (squared >= 1) continue
      const field = (y * 112 + x) * 4
      let albedo = .86 + .04 * Math.sin(x * .8) * Math.cos(y * 1.3)
      for (const [cx, cy, r] of craters) {
        const distance = Math.hypot(nx - cx!, ny - cy!) / r!
        if (distance < 1) albedo -= .28 * (1 - distance * distance)
        if (distance > .88 && distance < 1.12) albedo += .07
      }
      lunarGeometry.set([nx, ny, Math.sqrt(1 - squared), albedo], field)
      lunarPixels.data[field + 3] = Math.min(255, (1 - Math.sqrt(squared)) * 56 * 255)
    }
  }

  function resize(narrow: boolean) {
    compact = narrow
    const nextSize = narrow ? 320 : 480
    if (size === nextSize) return
    size = nextSize
    earth.width = earth.height = size
    pixels = surface!.createImageData(size, size)
    geometry = new Float32Array(size * size * 6)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x + .5) / size * 2 - 1
        const ny = (y + .5) / size * 2 - 1
        const squared = nx * nx + ny * ny
        if (squared >= 1) continue
        const nz = Math.sqrt(1 - squared)
        const latitude = Math.asin(-ny * .94 + nz * .341)
        const longitude = Math.atan2(nx, nz * .94 + ny * .341)
        const index = y * size + x
        geometry.set([nx, ny, nz, longitude / (Math.PI * 2), Math.max(0, Math.min(511, Math.floor((.5 - latitude / Math.PI) * 512))), Math.pow(1 - nz, 3)], index * 6)
        pixels.data[index * 4 + 3] = Math.min(255, (1 - Math.sqrt(squared)) * size / 2 * 255)
      }
    }
  }

  function draw(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, time: number, sun: Sunlight) {
    const lx = -Math.cos(sun.angle)
    const ly = -sun.elevation * .55
    const lz = sun.elevation * .85
    const length = Math.hypot(lx, ly, lz)
    const rotation = .125 + time * .0032
    for (let index = 0, field = 0; index < pixels.data.length; index += 4, field += 6) {
      const nz = geometry[field + 2]!
      if (nz === 0) continue
      const illumination = (geometry[field]! * lx + geometry[field + 1]! * ly + nz * lz) / length
      const diffuse = Math.max(0, illumination)
      const longitude = ((geometry[field + 3]! + rotation + .5) % 1 + 1) % 1
      const texel = (geometry[field + 4]! * 1024 + Math.floor(longitude * 1024)) * 4
      const shade = .24 + diffuse * .95
      const rim = geometry[field + 5]! * (.35 + diffuse * .65)
      pixels.data[index] = atlas![texel]! * shade + rim * 18
      pixels.data[index + 1] = atlas![texel + 1]! * shade + rim * 65
      pixels.data[index + 2] = atlas![texel + 2]! * shade + rim * 125
    }
    surface!.putImageData(pixels, 0, 0)

    for (let index = 0; index < lunarPixels.data.length; index += 4) {
      const nz = lunarGeometry[index + 2]!
      if (nz === 0) continue
      const diffuse = Math.max(0, (lunarGeometry[index]! * lx + lunarGeometry[index + 1]! * ly + nz * lz) / length)
      const gray = (38 + diffuse * 185) * lunarGeometry[index + 3]!
      lunarPixels.data[index] = gray
      lunarPixels.data[index + 1] = gray * .98
      lunarPixels.data[index + 2] = gray * .94
    }
    lunarSurface!.putImageData(lunarPixels, 0, 0)
    const orbit = -.9 + time * .025
    const moonX = cx + Math.cos(orbit) * radius * (compact ? 1.08 : 1.25)
    const moonY = cy + Math.sin(orbit) * radius * (compact ? 1.3 : 1.05)
    const moonRadius = radius * .15
    const drawMoon = () => ctx.drawImage(moon, moonX - moonRadius, moonY - moonRadius, moonRadius * 2, moonRadius * 2)
    if (Math.sin(orbit) < 0) drawMoon()
    const atmosphere = ctx.createRadialGradient(cx, cy, radius * .97, cx, cy, radius * 1.13)
    atmosphere.addColorStop(0, 'rgba(81,160,233,.2)')
    atmosphere.addColorStop(.25, 'rgba(62,133,214,.08)')
    atmosphere.addColorStop(1, 'rgba(62,133,214,0)')
    ctx.fillStyle = atmosphere
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 1.13, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    // 窄屏入口与地球共享纵向空间，降低球面亮度以保证文字对比。
    if (compact) ctx.globalAlpha = .58
    ctx.drawImage(earth, cx - radius, cy - radius, radius * 2, radius * 2)
    ctx.restore()
    if (Math.sin(orbit) >= 0) drawMoon()
  }
  return { resize, draw }
}
