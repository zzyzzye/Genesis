import { useState } from 'react'
import { saveFpsEnabled, useFpsEnabled } from '../features/performance/preferences'
import './FpsSettings.css'

export function FpsSettings() {
  const enabled = useFpsEnabled()
  const [error, setError] = useState(false)

  return <section className="fps-settings" aria-labelledby="fps-settings-title">
    <div className="fps-settings__row">
      <div>
        <h2 id="fps-settings-title">FPS 监测</h2>
        <p id="fps-settings-description">在页面右下角显示实时帧率，观察动画与特效的流畅度。</p>
        <small>仅此浏览器 · 全站生效 · 关闭后停止监测</small>
      </div>
      <button
        type="button"
        role="switch"
        aria-label="显示 FPS"
        aria-checked={enabled}
        aria-describedby={`fps-settings-description${error ? ' fps-settings-error' : ''}`}
        className="fps-settings__switch"
        onClick={() => setError(!saveFpsEnabled(!enabled))}
      >
        <span>{enabled ? '开启' : '关闭'}</span>
        <span className="fps-settings__track" aria-hidden="true"><span /></span>
      </button>
    </div>
    {error && <p id="fps-settings-error" className="fps-settings__error" role="alert">浏览器未允许保存设置，请检查存储权限后重试。</p>}
  </section>
}
