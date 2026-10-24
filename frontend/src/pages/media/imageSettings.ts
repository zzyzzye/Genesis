import type { GenerationSettings } from './api'

export const imageRatios = ['1:1', '1:2', '2:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'] as const
export const imageResolutions = ['1K', '2K', '4K'] as const

export function imageSizePatch(ratio: typeof imageRatios[number], resolution: typeof imageResolutions[number]): Partial<GenerationSettings> {
  const [width = 1, height = 1] = ratio.split(':').map(Number)
  const edge = { '1K':1024, '2K':2048, '4K':4096 }[resolution]
  // 以长边定义清晰度，短边对齐 8 像素；尺寸能否生成最终由所选模型校验。
  const short = Math.max(8, Math.round(edge * Math.min(width, height) / Math.max(width, height) / 8) * 8)
  return { image_ratio:ratio, image_resolution:resolution, image_size:width >= height ? `${edge}x${short}` : `${short}x${edge}` }
}

export function imageSettingsSummary(settings: GenerationSettings): string {
  const size = settings.image_resolution || (settings.image_size && settings.image_size !== 'auto' ? settings.image_size : '')
  const items = [settings.image_ratio, size].filter(Boolean)
  return [...(items.length ? items : ['模型默认']), `${settings.count}张`].join(' · ')
}
