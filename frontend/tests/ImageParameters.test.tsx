import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ImageParameters } from '../src/pages/media/ImageParameters'
import { defaultGenerationSettings, type GenerationSettings } from '../src/pages/media/api'
import { imageSettingsSummary, imageSizePatch } from '../src/pages/media/imageSettings'

describe('图片参数', () => {
  it.each([
    ['16:9', '2K', '2048x1152'], ['9:16', '1K', '576x1024'],
    ['1:2', '4K', '2048x4096'], ['21:9', '2K', '2048x880'],
  ] as const)('把 %s / %s 转为实际输出尺寸 %s', (ratio, resolution, size) => {
    expect(imageSizePatch(ratio, resolution)).toMatchObject({ image_ratio:ratio, image_resolution:resolution, image_size:size })
  })
  it('旧草稿保留自定义尺寸；只有主动选比例或清晰度才改写', () => {
    const initial: GenerationSettings = { ...defaultGenerationSettings(), image_size:'1536x1024', image_quality:'high' }
    function Harness() {
      const [settings, setSettings] = useState(initial)
      return <><ImageParameters settings={settings} onChange={patch=>setSettings(previous=>({...previous,...patch}))} /><output>{imageSettingsSummary(settings)}</output></>
    }
    render(<Harness />)
    expect(screen.getByRole('status')).toHaveTextContent('高画质 · 1536x1024 · 1张')
    fireEvent.click(screen.getByRole('button', { name:'使用模型默认画质' }))
    expect(screen.getByRole('status')).toHaveTextContent('1536x1024 · 1张')
    fireEvent.click(screen.getByRole('button', { name:'图片比例 9:16' }))
    expect(screen.getByRole('button', { name:'1K' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('9:16 · 1K · 1张')
    fireEvent.click(screen.getByRole('button', { name:'使用模型默认尺寸' }))
    expect(screen.getByRole('status')).toHaveTextContent('模型默认 · 1张')
    expect(screen.getByRole('button', { name:'图片比例 9:16' })).toHaveAttribute('aria-pressed', 'false')
  })
})
