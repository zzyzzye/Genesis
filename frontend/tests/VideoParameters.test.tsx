import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { defaultGenerationSettings } from '../src/pages/media/api'
import { VideoParameters } from '../src/pages/media/VideoParameters'

afterEach(cleanup)

function Harness() {
  const [settings, setSettings] = useState(defaultGenerationSettings)
  const [duration, setDuration] = useState(5)
  return <><VideoParameters settings={settings} duration={duration} onChange={patch => setSettings(previous => ({ ...previous, ...patch }))} onDurationChange={setDuration} onInteractionStart={() => undefined} onInteractionEnd={() => undefined} /><pre data-testid="settings">{JSON.stringify(settings)}</pre></>
}

it('视频比例和清晰度使用选项块，4K 保存为既有 2160P 请求值', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name:'画面比例 9:16' }))
  fireEvent.click(screen.getByRole('button', { name:'视频清晰度 4K' }))
  expect(screen.getByRole('button', { name:'画面比例 9:16' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name:'视频清晰度 4K' })).toHaveAttribute('aria-pressed', 'true')
  expect(JSON.parse(screen.getByTestId('settings').textContent || '{}')).toMatchObject({ ratio:'9:16', resolution:'2160P', count:1, sound:true })
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
})

it('时长滑杆与精确输入同步，保留 1–600 秒草稿范围', () => {
  render(<Harness />)
  fireEvent.change(screen.getByRole('slider', { name:'视频时长' }), { target:{ value:'12' } })
  expect(screen.getByRole('spinbutton', { name:'镜头时长' })).toHaveValue(12)
  const input = screen.getByRole('spinbutton', { name:'镜头时长' })
  fireEvent.change(input, { target:{ value:'600' } }); fireEvent.blur(input)
  expect(screen.getByRole('slider', { name:'视频时长' })).toHaveValue('600')
  expect(screen.getByLabelText('当前视频时长')).toHaveTextContent('600s')
})

it.each(['', '0', '601', '2.5'])('无效时长 %s 保留原值，并在修正后清除错误', value => {
  render(<Harness />)
  const input = screen.getByRole('spinbutton', { name:'镜头时长' })
  fireEvent.change(input, { target:{ value } }); fireEvent.blur(input)
  expect(input).toHaveValue(5)
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('status', { name:'视频时长错误' })).toHaveTextContent('已保留原时长')
  fireEvent.change(input, { target:{ value:'8' } }); fireEvent.blur(input)
  expect(screen.getByRole('slider', { name:'视频时长' })).toHaveValue('8')
  expect(screen.queryByRole('status', { name:'视频时长错误' })).not.toBeInTheDocument()
})
