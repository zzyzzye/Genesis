import { useState } from 'react'
import { Moon, RotateCcw, Sun } from 'lucide-react'
import { useMotionValueEvent, type MotionValue } from 'motion/react'
import { solarScene } from './solarScene'

/** 返回实时期间仅更新时间控件，不让整页入口随数字逐帧重渲染。 */
export function HomeSolarControls({ minute, following, returning, returnMinute, onPreview, onFollow }: {
  minute: number
  following: boolean
  returning: boolean
  returnMinute: MotionValue<number>
  onPreview: (minute: number) => void
  onFollow: () => void
}) {
  const [animatedMinute, setAnimatedMinute] = useState(() => returnMinute.get())
  useMotionValueEvent(returnMinute, 'change', setAnimatedMinute)
  const shownMinute = returning ? Math.round(animatedMinute) : minute
  const sunlight = solarScene(shownMinute)

  return <div className="home-solar-controls">
    <div className="home-solar-heading">
      <label htmlFor="home-daylight">
        <span className="home-solar-mode">{following ? '本地时间' : '光照预览'}</span>
        <span className="home-solar-reading"><strong>{sunlight.time}</strong><span className="home-solar-phase">{sunlight.label === '夜晚' ? <Moon size={13} aria-hidden="true" /> : <Sun size={13} aria-hidden="true" />}{sunlight.label}</span></span>
      </label>
      <button type="button" className="home-follow-time" aria-label="跟随本地时间" aria-pressed={following} onClick={onFollow}>
        {following ? <span className="home-solar-live" aria-hidden="true" /> : <RotateCcw size={12} aria-hidden="true" />}
        {following ? '实时同步' : '回到此刻'}
      </button>
    </div>
    <div className="home-solar-timeline">
      <input id="home-daylight" type="range" min="0" max="1439" step="1" value={shownMinute} aria-label="预览一天的光照" aria-valuetext={`${sunlight.time}，${sunlight.label}`} onPointerDown={() => { if (returning) onPreview(shownMinute) }} onChange={event => onPreview(Number(event.target.value))} />
      <div className="home-solar-ticks" aria-hidden="true">{['00', '06', '12', '18', '24'].map(hour => <span key={hour}>{hour}</span>)}</div>
    </div>
  </div>
}
