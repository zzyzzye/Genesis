import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeImage, outputDimensions, outputFilename, validateImage } from '../src/pages/toolbox/imageProcessing'

afterEach(() => vi.restoreAllMocks())

describe('本地图片处理', () => {
  it('无损模式拒绝有损格式和尺寸变更', async () => {
    const bitmap = { width: 400, height: 200 } as ImageBitmap
    await expect(encodeImage(bitmap, { format: 'image/webp', quality: 1, maxEdge: null, background: '#ffffff', lossless: true })).rejects.toThrow('无损模式仅支持原尺寸 PNG')
    await expect(encodeImage(bitmap, { format: 'image/png', quality: 1, maxEdge: 100, background: '#ffffff', lossless: true })).rejects.toThrow('无损模式仅支持原尺寸 PNG')
  })
  it('等比缩小，不放大，并拒绝无效尺寸', () => {
    expect(outputDimensions(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 })
    expect(outputDimensions(100, 200, 1000)).toEqual({ width: 100, height: 200 })
    expect(outputDimensions(4000, 1, 1)).toEqual({ width: 1, height: 1 })
    for (const edge of [0, -1, NaN, 2.5, 8193]) expect(() => outputDimensions(400, 300, edge)).toThrow('最长边')
  })
  it('下载扩展名与实际输出格式一致', () => {
    expect(outputFilename('旅行.原图.PNG', 'image/jpeg')).toBe('旅行.原图-converted.jpg')
    expect(outputFilename('无扩展名', 'image/webp')).toBe('无扩展名-converted.webp')
  })
  it('按文件头校验，拒绝空文件、超限和伪装图片', async () => {
    const file = new File(['not an image'], 'image.png', { type: 'image/png' })
    // jsdom 的 File 尚未提供 arrayBuffer，使用相同字节的 Blob 接口替身。
    vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: () => Promise.resolve(new TextEncoder().encode('not an image').buffer) } as Blob)
    await expect(validateImage(file)).rejects.toThrow('请选择 PNG')
    await expect(validateImage(new File([], 'empty.png'))).rejects.toThrow('为空')
    Object.defineProperty(file, 'size', { value: 21 * 1024 * 1024 })
    await expect(validateImage(file)).rejects.toThrow('超过 20 MB')
  })
  it('JPEG 先填背景再绘制，保留尺寸并释放画布', async () => {
    const calls: string[] = []
    const context = { fillStyle: '', fillRect: vi.fn(() => calls.push('background')), drawImage: vi.fn(() => calls.push('image')) }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => { callback(new Blob(['jpeg'], { type })) })
    const result = await encodeImage({ width: 400, height: 200 } as ImageBitmap, { format: 'image/jpeg', quality: .8, maxEdge: 100, background: '#ffffff' })
    expect(result.width).toBe(100); expect(result.height).toBe(50)
    expect(calls).toEqual(['background', 'image'])
    expect(context.fillStyle).toBe('#ffffff')
    expect((encode.mock.contexts[0] as HTMLCanvasElement).width).toBe(0)
  })
  it('PNG 不填背景，并拒绝编码器静默回退', async () => {
    const context = { fillRect: vi.fn(), drawImage: vi.fn() }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['png'], { type: 'image/png' })))
    const bitmap = { width: 20, height: 20 } as ImageBitmap
    await encodeImage(bitmap, { format: 'image/png', quality: .8, maxEdge: null, background: '#ffffff' })
    expect(context.fillRect).not.toHaveBeenCalled()
    await expect(encodeImage(bitmap, { format: 'image/webp', quality: .8, maxEdge: null, background: '#ffffff' })).rejects.toThrow('不支持导出此格式')
  })
  it('编码失败可恢复而不产生无效下载', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(null))
    await expect(encodeImage({ width: 20, height: 20 } as ImageBitmap, { format: 'image/png', quality: .8, maxEdge: null, background: '#ffffff' })).rejects.toThrow('编码失败')
  })
})
