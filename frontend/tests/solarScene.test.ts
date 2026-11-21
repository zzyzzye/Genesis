import { describe, expect, it } from 'vitest'
import { nearestSolarMinute, solarScene } from '../src/pages/home/solarScene'

describe('首页昼夜光照', () => {
  it('跨午夜沿相邻分钟过渡，不绕行整个白天', () => {
    expect(nearestSolarMinute(1439, 0)).toBe(1440)
    expect(nearestSolarMinute(0, 1439)).toBe(-1)
    expect(nearestSolarMinute(1441, 2)).toBe(1442)
    expect(nearestSolarMinute(-1, 1)).toBe(1)
    expect(nearestSolarMinute(540.5, 541)).toBe(541)
    expect(solarScene(nearestSolarMinute(1439, 0))).toEqual(solarScene(0))
  })

  it('早晨与傍晚的光源分处两侧，正午升起、午夜落下', () => {
    expect(Math.cos(solarScene(360).angle)).toBeCloseTo(1)
    expect(Math.cos(solarScene(1080).angle)).toBeCloseTo(-1)
    expect(solarScene(720).elevation).toBeCloseTo(1)
    expect(solarScene(0).elevation).toBeCloseTo(-1)
    expect(solarScene(0).daylight).toBe(0)
  })

  it('跨日时间保持循环且正确展示时分和阶段', () => {
    expect(solarScene(1440)).toEqual(solarScene(0))
    expect(solarScene(-1).time).toBe('23:59')
    expect(solarScene(360).label).toBe('晨光')
    expect(solarScene(750).time).toBe('12:30')
    expect(solarScene(1080).label).toBe('暮色')
  })
})
