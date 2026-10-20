import { expect, it } from 'vitest'

const assets = import.meta.glob<string>('../src/assets/comment-devices/*.svg', { query: '?raw', import: 'default', eager: true })

it('品牌资源都有独立视口，禁止脚本和外部图片请求', () => {
  expect(Object.keys(assets).length).toBeGreaterThan(0)
  for (const [name, svg] of Object.entries(assets)) {
    expect(svg, name).toMatch(/<svg[^>]+viewBox="[^"]+"/)
    expect(svg, name).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=/i)
    for (const match of svg.matchAll(/(?:href|src)="([^"]+)"/g)) {
      const reference = match[1] ?? ''
      expect(reference.startsWith('#') || reference.startsWith('data:image/png;base64,'), name).toBe(true)
    }
  }
})
