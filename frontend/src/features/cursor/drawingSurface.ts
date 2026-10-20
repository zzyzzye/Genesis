type Point = { x: number; y: number }

/** 只为当前笔迹分配画布，避免在高分屏上反复清空、滤镜处理整个视口。 */
export function createDrawingSurface(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  let width = 0, height = 0

  function clear() {
    if (width === 0 && height === 0) return
    canvas.hidden = true
    canvas.width = 1
    canvas.height = 1
    width = 0; height = 0
  }

  function begin(points: readonly Point[], padding: number, scale = 1, anchor: Point = { x: 0, y: 0 }) {
    if (!points.length) { clear(); return false }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
    for (const point of points) {
      const x = anchor.x + (point.x - anchor.x) * scale
      const y = anchor.y + (point.y - anchor.y) * scale
      left = Math.min(left, x); top = Math.min(top, y)
      right = Math.max(right, x); bottom = Math.max(bottom, y)
    }
    left = Math.max(0, Math.floor(left - padding)); top = Math.max(0, Math.floor(top - padding))
    right = Math.min(innerWidth, Math.ceil(right + padding)); bottom = Math.min(innerHeight, Math.ceil(bottom + padding))
    if (right <= left || bottom <= top) { clear(); return false }
    const nextWidth = Math.min(innerWidth, Math.ceil((right - left) / 64) * 64)
    const nextHeight = Math.min(innerHeight, Math.ceil((bottom - top) / 64) * 64)
    const ratio = Math.min(devicePixelRatio || 1, 2)
    // 按 64px 分档复用位图；轨迹消散后再收小，避免每帧重新分配。
    const resized = nextWidth > width || nextHeight > height || nextWidth < width / 2 || nextHeight < height / 2
    if (resized) {
      width = nextWidth; height = nextHeight
      canvas.width = Math.ceil(width * ratio); canvas.height = Math.ceil(height * ratio)
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
    } else {
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
    }
    left = Math.min(left, innerWidth - width); top = Math.min(top, innerHeight - height)
    canvas.hidden = false
    canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`
    context.setTransform(ratio, 0, 0, ratio, -left * ratio, -top * ratio)
    return true
  }

  return { begin, clear }
}
