import { describe, expect, it } from 'vitest'
import { safeSvg } from '../src/pages/toolbox/svgSafety'
import { amountLabel, billingLabel } from '../src/features/billing/api'

const wrap = (value: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${value}</svg>`
describe('免费 SVG 的安全结果', () => {
  it('保留静态图形及本地渐变引用', () => {
    const source = wrap('<defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="100" height="100" fill="url(#paint)"/>')
    expect(safeSvg(source)).toContain('fill="url(#paint)"')
    expect(safeSvg(`\`\`\`svg\n${source}\n\`\`\``)).toContain('viewBox="0 0 100 100"')
  })
  it('移除脚本、事件、HTML、动画和外部资源', () => {
    const source = wrap('<script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject><image href="https://example.com/a"/><rect onclick="alert(1)" fill="url(https://example.com/a)"/><use href="https://example.com/b#x"/><animate attributeName="href"/><style>@import "https://example.com";</style>')
    const result = safeSvg(source)
    expect(result).not.toMatch(/script|foreignObject|onclick|https:\/\/example|<animate|<style|<image/)
  })
  it.each(['<svg>', '<html/>', '<svg xmlns="http://www.w3.org/2000/svg"><path/></sv>', '<!DOCTYPE svg [<!ENTITY x "test">]><svg/>'])('拒绝不完整或非法 SVG：%s', source => {
    expect(() => safeSvg(source)).toThrow()
  })
})
describe('费用展示精度', () => {
  it('不把微小费用四舍五入成零，也不转成浮点数', () => {
    expect(amountLabel('0.00025200')).toBe('¥0.000252')
    expect(amountLabel('1.00000000')).toBe('¥1.00')
    expect(amountLabel('-0.00000001')).toBe('¥-0.00000001')
  })
  it('免费和未知账单不显示为实际零扣费', () => {
    expect(billingLabel({ mode:'free' } as Parameters<typeof billingLabel>[0])).toBe('MiMo 免费')
    expect(billingLabel({ mode:'paid',status:'pending',reserved_amount:'0.01000000' } as Parameters<typeof billingLabel>[0])).toContain('待结算')
    expect(billingLabel({ mode:'paid',status:'settled',charged_amount:'0.00025200' } as Parameters<typeof billingLabel>[0])).toBe('已结算 ¥0.000252')
  })
})
