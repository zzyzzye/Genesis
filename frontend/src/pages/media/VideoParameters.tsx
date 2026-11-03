import { useId, useState } from 'react'
import type { GenerationSettings } from './api'
import { RatioOptions } from './RatioOptions'

const ratios: GenerationSettings['ratio'][] = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', '3:2', '2:3']
const resolutions: GenerationSettings['resolution'][] = ['480P', '720P', '1080P', '2160P', '768P', '2K']

export function VideoParameters({ settings, duration, onChange, onDurationChange, onInteractionStart, onInteractionEnd }: {
  settings: GenerationSettings; duration: number
  onChange: (patch: Partial<GenerationSettings>) => void; onDurationChange: (seconds: number) => void
  onInteractionStart: () => void; onInteractionEnd: () => void
}) {
  const [error, setError] = useState('')
  const errorId = useId()
  return <>
    <fieldset><legend>比例</legend><RatioOptions ratios={ratios} value={settings.ratio} label="画面比例" onChange={ratio => onChange({ ratio: ratio as GenerationSettings['ratio'] })} /></fieldset>
    <fieldset><legend>清晰度</legend><div className="media-image-options media-video-resolution-options">{resolutions.map(resolution => <button type="button" key={resolution} aria-label={`视频清晰度 ${resolution === '2160P' ? '4K' : resolution}`} aria-pressed={settings.resolution === resolution} onClick={() => onChange({ resolution })}>{resolution === '2160P' ? '4K' : resolution}</button>)}</div></fieldset>
    <fieldset className="media-video-duration"><legend><span>视频时长</span><output aria-label="当前视频时长">{duration}s</output></legend>
      <input type="range" aria-label="视频时长" aria-valuetext={`${duration} 秒`} min={1} max={600} step={1} value={duration} onFocus={onInteractionStart} onBlur={onInteractionEnd} onChange={event => { setError(''); onDurationChange(Number(event.target.value)) }} />
      <div className="media-video-duration-exact"><span>精确秒数</span><input key={duration} type="number" aria-label="镜头时长" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} min={1} max={600} step={1} defaultValue={duration} onFocus={onInteractionStart} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} onBlur={event => {
        const seconds = Number(event.target.value)
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
          setError('请输入 1–600 的整数秒，已保留原时长。')
          event.target.value = String(duration)
        } else {
          setError('')
          if (seconds !== duration) onDurationChange(seconds)
        }
        onInteractionEnd()
      }} /><span>秒</span></div>
      {error && <p className="media-node-field-error" id={errorId} role="status" aria-label="视频时长错误">{error}</p>}
    </fieldset>
  </>
}
