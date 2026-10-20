import { useState } from 'react'
import { Check, MousePointer2, MoveUpRight } from 'lucide-react'
import { cursorThemes, saveCursorTheme, useCursorTheme } from '../features/cursor/preferences'
import { isArrowSkin, skinImage, type SkinState } from '../features/cursor/arrowSkinAssets'
import './SystemSettings.css'

const states: { id: SkinState; label: string }[] = [{ id: 'default', label: '普通' }, { id: 'pointer', label: '链接' }, { id: 'text', label: '输入' }, { id: 'grab', label: '拖拽' }, { id: 'disabled', label: '禁用' }]

export function SystemSettings() {
  const selected = useCursorTheme()
  const [error, setError] = useState(false)
  const [clicks, setClicks] = useState(0)
  const [preview, setPreview] = useState<SkinState>('default')
  const theme = cursorThemes.find(item => item.id === selected)!
  const skin = isArrowSkin(selected) ? selected : null
  const skins = cursorThemes.filter(item => isArrowSkin(item.id))
  const effects = cursorThemes.filter(item => item.id !== 'system' && !isArrowSkin(item.id))
  function option(item: typeof cursorThemes[number]) {
    return <button type="button" className={`cursor-settings__option${isArrowSkin(item.id) ? ' cursor-settings__option--skin' : ''}`} aria-pressed={selected === item.id} key={item.id} onClick={() => setError(!saveCursorTheme(item.id))}>
      <span className="cursor-settings__sample" aria-hidden="true">{isArrowSkin(item.id) ? <img src={skinImage(item.id)} alt="" /> : <MousePointer2 />}</span>
      <span className="cursor-settings__caption"><strong>{item.name}</strong><small>{item.signature}</small></span>
      <span className="cursor-settings__check" aria-hidden="true">{selected === item.id && <Check size={14} />}</span>
    </button>
  }
  return <section className="cursor-settings" aria-labelledby="cursor-settings-title">
    <header className="cursor-settings__heading"><div><h2 id="cursor-settings-title">光标外观</h2><p>换一身材质，保留熟悉的箭头。</p></div><button type="button" className="cursor-settings__reset" aria-pressed={selected === 'system'} onClick={() => setError(!saveCursorTheme('system'))}><MousePointer2 size={14} />系统默认</button></header>
    <div className="cursor-settings__layout">
      <div className="cursor-settings__catalog"><div className="cursor-settings__section-title"><h3>箭头皮肤</h3><span>5 套 · 配套操作状态</span></div><div className="cursor-settings__options" aria-label="选择箭头皮肤">{skins.map(option)}</div>
        <details className="cursor-settings__effects" open={effects.some(item => item.id === selected) || undefined}><summary>角色与动态效果 <span>{effects.length} 款</span></summary><div className="cursor-settings__effect-list">{effects.map(option)}</div></details>
        <p className="cursor-settings__scope">选择即保存 · 仅此浏览器 · 全站生效</p>
      </div>
      <div className="cursor-settings__preview">
        <div className="cursor-settings__preview-title"><span>现场试用</span><span>{theme.name}</span></div>
        <div className="cursor-settings__playground" data-cursor-state={preview}>
          {skin ? <img className="cursor-settings__hero" src={skinImage(skin, preview)} alt={`${theme.name} · ${states.find(item => item.id === preview)!.label}状态预览`} /> : <MousePointer2 className="cursor-settings__native" aria-hidden="true" />}
          <p>{skin ? '造型换新，落点依旧准确' : selected === 'system' ? '选一套皮肤，移入这里体验' : '移动、停留，再轻轻点击'}</p>
          <button type="button" className="cursor-settings__try" data-cursor-label="试试" onClick={() => setClicks(value => value + 1)}>试试点击 <MoveUpRight size={16} /></button><span className="cursor-settings__clicks" aria-live="polite">{clicks ? `已响应 ${clicks} 次点击` : '等待第一次点击'}</span>
        </div>
        {skin && <div className="cursor-settings__states" aria-label="预览光标状态">{states.map(state => <button type="button" key={state.id} aria-pressed={preview === state.id} onClick={() => setPreview(state.id)} data-cursor-state={state.id}><img src={skinImage(skin, state.id)} alt="" /><span>{state.label}</span></button>)}</div>}
        <label className="cursor-settings__input">输入与选择文字<input placeholder="在这里试试中文输入与文字选择…" /></label>
      </div>
    </div>
    <footer className="cursor-settings__footer"><p role="status">{error ? '浏览器未允许保存设置，请检查存储权限后重试。' : `当前：${theme.name}。${theme.detail}。`}</p><p>{skin ? '箭头、手型、文本选择、拖拽和禁用保持统一材质；触屏与高对比模式使用系统光标。' : '角色与动态效果在输入、文字选择和画布拖拽时恢复原生光标，减少动态效果时关闭拖尾与涟漪。'}</p><details><summary>设计参考</summary><p>箭头皮肤与奇幻角色为原创绘制，动态效果参考以下交互方向。</p><a href="https://tympanus.net/codrops/2023/06/07/gooey-cursor-effect/" target="_blank" rel="noreferrer">液态融合</a><a href="https://tympanus.net/codrops/2025/02/06/building-a-playful-stop-motion-crayon-cursor-in-p5-js/" target="_blank" rel="noreferrer">手绘蜡笔</a><a href="https://tympanus.net/codrops/2022/08/24/custom-svg-cursors-with-an-interactive-emitter-effect/" target="_blank" rel="noreferrer">波纹发射</a><a href="https://tympanus.net/codrops/2026/08/25/building-a-mouse-following-square-lens-effect-with-three-js-and-glsl/" target="_blank" rel="noreferrer">方形透镜</a><a href="https://cuberto.com/blog/cuberto-mouse-follower/" target="_blank" rel="noreferrer">语境跟随</a></details></footer>
  </section>
}
