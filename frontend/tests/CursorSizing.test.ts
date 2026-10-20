import { describe, expect, it } from 'vitest'
import { arrowSkinIds, skinImage, skinStyles } from '../src/features/cursor/arrowSkinAssets'

describe('实际光标尺寸与落点', () => {
  it.each(arrowSkinIds)('%s 的原生操作图像为紧凑尺寸，hotspot 随图像一起缩放', skin => {
    const rules = [...skinStyles(skin).matchAll(/url\("([^"]+)"\) (\d+) (\d+), ([\w-]+)/g)]
    expect(rules.length).toBeGreaterThanOrEqual(5)
    for (const [, url, x, y] of rules) {
      const svg = new DOMParser().parseFromString(decodeURIComponent(url!.split(',')[1]!), 'image/svg+xml').documentElement
      expect(svg.getAttribute('width')).toBe('24')
      expect(svg.getAttribute('height')).toBe('24')
      expect(Number(x)).toBeLessThan(24)
      expect(Number(y)).toBeLessThan(24)
    }
    expect(rules[0]?.slice(2)).toEqual(['3', '2', 'default'])
    expect(rules[1]?.slice(2)).toEqual(['10', '3', 'pointer'])
    expect(rules[2]?.slice(2)).toEqual(['11', '11', 'text'])
    const preview = new DOMParser().parseFromString(decodeURIComponent(skinImage(skin).split(',')[1]!), 'image/svg+xml').documentElement
    expect(preview.getAttribute('width')).toBe('40')
  })
})
