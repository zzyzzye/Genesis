import { useState } from 'react'
import { Check, Feather, MousePointer2, MoveUpRight, Sparkles, Flame } from 'lucide-react'
import { cursorThemes, saveCursorTheme, useCursorTheme } from '../features/cursor/preferences'
import './SystemSettings.css'

export function SystemSettings() {
  const selected = useCursorTheme()
  const [error, setError] = useState(false)
  const [clicks, setClicks] = useState(0)
  const theme = cursorThemes.find(item => item.id === selected)!
  return <section className="cursor-settings" aria-labelledby="cursor-settings-title">
    <header className="cursor-settings__heading"><div><h2 id="cursor-settings-title">光标外观</h2><p>给每一次移动一点性格。</p></div><span>仅此浏览器 · 全站生效</span></header>
    <div className="cursor-settings__layout">
      <div className="cursor-settings__options" aria-label="选择光标主题">
        {cursorThemes.map(item => <button type="button" className="cursor-settings__option" aria-pressed={selected === item.id} key={item.id} onClick={() => setError(!saveCursorTheme(item.id))}>
          <span className={`cursor-settings__mark cursor-settings__mark--${item.id}`} aria-hidden="true">{item.id === 'system' ? <MousePointer2 /> : item.id === 'quill' ? <Feather /> : item.id === 'starlight' ? <Sparkles /> : item.id === 'dragon' ? <Flame /> : <i />}</span>
          <span><strong>{item.name}</strong><small>{item.signature}</small></span>
          {selected === item.id && <Check size={16} aria-label="已选择" />}
        </button>)}
      </div>
      <div className="cursor-settings__preview">
        <div className="cursor-settings__preview-title"><span>交互试验场</span><span>{theme.name}</span></div>
        <div className="cursor-settings__playground"><span className="cursor-settings__word" aria-hidden="true">Genesis.</span><p>{selected === 'system' ? '从左侧选一种风格，开始体验' : '移动、停留，再轻轻点击'}</p><button type="button" className="cursor-settings__try" data-cursor-label="试试" onClick={() => setClicks(value => value + 1)}>试试点击 <MoveUpRight size={16} /></button><span className="cursor-settings__clicks" aria-live="polite">{clicks ? `已响应 ${clicks} 次点击` : '等待第一次点击'}</span></div>
        <label className="cursor-settings__input">输入与选择文字<input placeholder="在这里试试中文输入与文字选择…" /></label>
      </div>
    </div>
    <footer className="cursor-settings__footer"><p role="status">{error ? '浏览器未允许保存设置，请检查存储权限后重试。' : `当前：${theme.name}。${theme.detail}。`}</p><p>选择即保存。输入、文字选择和画布拖拽使用原生光标；触屏与高对比模式自动使用系统默认，减少动态效果时关闭拖尾与涟漪。</p><details><summary>设计参考</summary><p>根据以下交互方向独立实现，已适配 Genesis 的操作状态。</p><a href="https://tympanus.net/codrops/2023/06/07/gooey-cursor-effect/" target="_blank" rel="noreferrer">液态融合</a><a href="https://tympanus.net/codrops/2025/02/06/building-a-playful-stop-motion-crayon-cursor-in-p5-js/" target="_blank" rel="noreferrer">手绘蜡笔</a><a href="https://tympanus.net/codrops/2022/08/24/custom-svg-cursors-with-an-interactive-emitter-effect/" target="_blank" rel="noreferrer">波纹发射</a><a href="https://tympanus.net/codrops/2026/08/25/building-a-mouse-following-square-lens-effect-with-three-js-and-glsl/" target="_blank" rel="noreferrer">方形透镜</a><a href="https://cuberto.com/blog/cuberto-mouse-follower/" target="_blank" rel="noreferrer">语境跟随</a></details></footer>
  </section>
}
