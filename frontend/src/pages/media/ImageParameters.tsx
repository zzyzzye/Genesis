import type { GenerationSettings } from './api'
import { imageQualities, imageRatios, imageResolutions, imageSizePatch } from './imageSettings'

export function ImageParameters({ settings, onChange }: { settings: GenerationSettings; onChange: (patch: Partial<GenerationSettings>) => void }) {
  return <>
    <fieldset><legend>画质</legend><button type="button" className="media-image-default" aria-label="使用模型默认画质" aria-pressed={!settings.image_quality} onClick={() => onChange({ image_quality:'' })}>默认</button><div className="media-image-options">{imageQualities.map(({ value, label }) => <button type="button" key={value} aria-pressed={settings.image_quality === value} onClick={() => onChange({ image_quality:value })}>{label}</button>)}</div></fieldset>
    <fieldset><legend>清晰度</legend><button type="button" className="media-image-default" aria-label="使用模型默认尺寸" aria-pressed={!settings.image_size || settings.image_size === 'auto'} onClick={() => onChange({ image_size:'', image_resolution:'', image_ratio:'' })}>默认</button><div className="media-image-options">{imageResolutions.map((value) => <button type="button" key={value} aria-pressed={settings.image_resolution === value} onClick={() => onChange(imageSizePatch(settings.image_ratio || '1:1', value))}>{value}</button>)}</div></fieldset>
    <fieldset><legend>背景</legend><div className="media-image-options">{([{ value:'auto', label:'自动' }, { value:'opaque', label:'保留背景' }, { value:'transparent', label:'透明背景' }] as const).map(({ value, label }) => <button type="button" key={value} aria-pressed={(settings.image_background || 'auto') === value} onClick={() => onChange({ image_background:value })}>{label}</button>)}</div></fieldset>
    <fieldset><legend>比例</legend><div className="media-image-options media-image-ratios">{imageRatios.map((value) => {
      const [w = 1, h = 1] = value.split(':').map(Number)
      const width = 18 * w / Math.max(w, h), height = 18 * h / Math.max(w, h)
      return <button type="button" key={value} aria-label={`图片比例 ${value}`} aria-pressed={settings.image_ratio === value} onClick={() => onChange(imageSizePatch(value, settings.image_resolution || '1K'))}><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x={(24 - width) / 2} y={(24 - height) / 2} width={width} height={height} rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><span>{value}</span></button>
    })}</div></fieldset>
    <fieldset><legend>生成数量</legend><div className="media-image-options">{([1, 2, 4] as const).map((value) => <button type="button" key={value} aria-label={`生成 ${value} 张图片`} aria-pressed={settings.count === value} onClick={() => onChange({ count:value })}>{value}张</button>)}</div></fieldset>
  </>
}
