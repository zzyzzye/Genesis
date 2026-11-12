export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp'
export interface ImageOptions { format: ImageFormat; quality: number; maxEdge: number | null; background: '#ffffff' | '#000000' }
export const imageFormats = [{ mime: 'image/jpeg', label: 'JPEG', extension: 'jpg' }, { mime: 'image/png', label: 'PNG', extension: 'png' }, { mime: 'image/webp', label: 'WebP', extension: 'webp' }] as const
export const maxFileBytes = 20 * 1024 * 1024
export const maxPixels = 24_000_000

/** 按实际文件头检查，避免将改扩展名的文件当作图片处理。 */
export async function validateImage(file: File): Promise<void> {
  if (!file.size) throw new Error('图片文件为空，请重新选择。')
  if (file.size > maxFileBytes) throw new Error('图片超过 20 MB，请选择更小的文件。')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!png && !jpeg && !webp) throw new Error('请选择 PNG、JPEG 或 WebP 图片。暂不支持 GIF、SVG 和 HEIC。')
}

export function outputDimensions(width: number, height: number, maxEdge: number | null) {
  if (maxEdge !== null && (!Number.isInteger(maxEdge) || maxEdge < 1 || maxEdge > 8192)) throw new Error('最长边请输入 1–8192 之间的整数，或留空保留原尺寸。')
  const scale = maxEdge === null ? 1 : Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function outputFilename(name: string, format: ImageFormat) {
  const stem = name.replace(/\.[^.]+$/, '') || 'image'
  return `${stem}-converted.${imageFormats.find(item => item.mime === format)!.extension}`
}

export function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** 复用浏览器编码器，拒绝不支持格式时静默回退的 PNG。 */
export async function encodeImage(bitmap: ImageBitmap, options: ImageOptions): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = outputDimensions(bitmap.width, bitmap.height, options.maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片画布，请换用较新的浏览器。')
    if (options.format === 'image/jpeg') { context.fillStyle = options.background; context.fillRect(0, 0, width, height) }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败，请降低尺寸后重试。')), options.format, options.quality)
    })
    if (blob.type !== options.format) throw new Error('当前浏览器不支持导出此格式，请选择 PNG 或 JPEG。')
    return { blob, width, height }
  } finally {
    // 编码结束立即释放画布像素缓冲，结果只保留 Blob。
    canvas.width = 0; canvas.height = 0
  }
}
