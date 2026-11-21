import { describe, expect, it } from 'vitest'
import { nextRibbonFishRoute, ribbonFishPose, RIBBON_FISH_ROUTES } from '../src/pages/home/ribbonFish'

describe('鱼影航迹', () => {
  it('各航线从屏幕外进入并离开，朝向连续跟随各自的弧线', () => {
    for (let route = 0; route < RIBBON_FISH_ROUTES.length; route++) {
      for (const direction of [-1, 1]) {
        for (const progress of [.001, .999]) {
          const pose = ribbonFishPose(1440, 900, progress, direction, route)!
          expect(pose.x < 0 || pose.x > 1440 || pose.y < 0 || pose.y > 900).toBe(true)
        }
        for (const progress of [.2, .5, .8]) {
          const before = ribbonFishPose(1440, 900, progress - .0001, direction, route)!
          const after = ribbonFishPose(1440, 900, progress + .0001, direction, route)!
          const current = ribbonFishPose(1440, 900, progress, direction, route)!
          expect(current.pitch).toBeCloseTo(Math.atan2(after.y - before.y, Math.abs(after.x - before.x)), 5)
        }
      }
    }
  })

  it('首次可选全部航线，后续排除上一条且不越界', () => {
    const count = RIBBON_FISH_ROUTES.length
    const samples = Array.from({ length: 101 }, (_, i) => i / 100)
    expect(new Set(samples.map(sample => nextRibbonFishRoute(-1, sample))).size).toBe(count)
    for (let previous = 0; previous < count; previous++) {
      const choices = new Set(samples.map(sample => nextRibbonFishRoute(previous, sample)))
      expect(choices.size).toBe(count - 1)
      expect(choices.has(previous)).toBe(false)
      expect([...choices].every(route => route >= 0 && route < count)).toBe(true)
    }
  })

  it('出现前和退场后不保留鱼影，首尾透明度平滑归零', () => {
    expect(ribbonFishPose(1440, 900, -.1, 1)).toBeNull()
    expect(ribbonFishPose(1440, 900, 1, 1)).toBeNull()
    expect(ribbonFishPose(1440, 900, .001, 1)!.opacity).toBeLessThan(.001)
    expect(ribbonFishPose(1440, 900, .999, 1)!.opacity).toBeLessThan(.001)
  })

  it('俯仰与实际弧线切线一致，途中有高度和远近变化', () => {
    for (const progress of [.2, .45, .7, .9]) {
      const before = ribbonFishPose(1440, 900, progress - .0001, 1)!
      const after = ribbonFishPose(1440, 900, progress + .0001, 1)!
      const current = ribbonFishPose(1440, 900, progress, 1)!
      expect(current.pitch).toBeCloseTo(Math.atan2(after.y - before.y, after.x - before.x), 5)
    }
    const entering = ribbonFishPose(1440, 900, .2, 1)!
    const middle = ribbonFishPose(1440, 900, .5, 1)!
    expect(entering.y - middle.y).toBeGreaterThan(150)
    expect(middle.length).toBeGreaterThan(entering.length)
  })

  it('反向游动镜像水平航迹，不倒置身体或改变高度', () => {
    for (const progress of [.1, .4, .7, .9]) {
      const forward = ribbonFishPose(390, 844, progress, 1)!
      const reverse = ribbonFishPose(390, 844, progress, -1)!
      expect(forward.x + reverse.x).toBeCloseTo(390)
      expect(reverse.y).toBe(forward.y)
      expect(reverse.length).toBe(forward.length)
      expect(reverse.pitch).toBe(forward.pitch)
    }
  })
})
