import { useState } from 'react'
import { Check, MousePointer2, MoveUpRight } from 'lucide-react'
import { cursorThemes, cursorTrails, resetCursorPreferences, saveCursorTheme, saveCursorTrail, useCursorTheme, useCursorTrail } from '../features/cursor/preferences'
import { isArrowSkin, skinImage, type SkinState } from '../features/cursor/arrowSkinAssets'
import { CursorSample } from '../features/cursor/CursorSample'
import './CursorSettings.css'

const states: { id: SkinState; label: string }[] = [{ id: 'default', label: '普通' }, { id: 'pointer', label: '链接' }, { id: 'text', label: '输入' }, { id: 'grab', label: '拖拽' }, { id: 'disabled', label: '禁用' }]

export function CursorSettings() {
  const selected = useCursorTheme()
  const trail = useCursorTrail()
  const [error, setError] = useState(false)
  const [clicks, setClicks] = useState(0)
  const [preview, setPreview] = useState<SkinState>('default')
  const theme = cursorThemes.find(item => item.id === selected)!
  const skin = isArrowSkin(selected) ? selected : null
  const skins = cursorThemes.filter(item => item.id === 'system' || isArrowSkin(item.id))
  const effects = cursorThemes.filter(item => item.id !== 'system' && !isArrowSkin(item.id))
  function option(item: typeof cursorThemes[number]) {
    return <button type="button" className={`cursor-settings__option${isArrowSkin(item.id) ? ' cursor-settings__option--skin' : ''}`} aria-pressed={selected === item.id} key={item.id} onClick={() => setError(!saveCursorTheme(item.id))}>
      <span className="cursor-settings__sample" aria-hidden="true"><CursorSample theme={item.id} /></span>
      <span className="cursor-settings__caption"><strong>{item.name}</strong><small>{item.signature}</small></span>
      {isArrowSkin(item.id) && <span className="cursor-settings__mini-states" aria-hidden="true">{states.map(state=><img key={state.id} src={skinImage(item.id as Parameters<typeof skinImage>[0],state.id)} alt="" />)}</span>}
      <span className="cursor-settings__check" aria-hidden="true">{selected === item.id && <Check size={14} />}</span>
    </button>
  }
  return <section className="cursor-settings" aria-labelledby="cursor-settings-title">
    <header className="cursor-settings__heading"><div><h2 id="cursor-settings-title">光标外观</h2><p>全部造型直接可见，悬停预览动态，点击即可使用。</p></div><button type="button" className="cursor-settings__reset" onClick={() => setError(!resetCursorPreferences())}><MousePointer2 size={14} />恢复全部默认</button></header>
    <div className="cursor-settings__layout">
      <div className="cursor-settings__catalog"><div className="cursor-settings__section-title"><h3>箭头皮肤</h3><span>5 套皮肤与系统默认</span></div><div className="cursor-settings__options" aria-label="选择箭头皮肤">{skins.map(option)}</div>
        <section className="cursor-settings__all-effects" aria-labelledby="cursor-effects-title"><div className="cursor-settings__section-title"><h3 id="cursor-effects-title">角色与动态效果</h3><span>{effects.length} 款 · 悬停可动</span></div><div className="cursor-settings__options" aria-label="选择角色与动态效果">{effects.map(option)}</div></section>
        <section className="cursor-settings__all-effects" aria-labelledby="cursor-trails-title"><div className="cursor-settings__section-title"><h3 id="cursor-trails-title">鼠标拖尾</h3><span>独立搭配任意光标</span></div><div className="cursor-settings__options cursor-settings__trail-options" aria-label="选择鼠标拖尾">{cursorTrails.map(item=><button type="button" className="cursor-settings__option" key={item.id} aria-pressed={trail===item.id} onClick={()=>setError(!saveCursorTrail(item.id))}><span className="cursor-settings__sample" aria-hidden="true"><CursorSample trail={item.id} /></span><span className="cursor-settings__caption"><strong>{item.name}</strong><small>{item.detail}</small></span><span className="cursor-settings__check" aria-hidden="true">{trail===item.id&&<Check size={14}/>}</span></button>)}</div></section>
        <p className="cursor-settings__scope">选择即保存 · 仅此浏览器 · 全站生效</p>
      </div>
      <div className="cursor-settings__preview">
        <div className="cursor-settings__preview-title"><span>放大预览 · 现场试用</span><span>{theme.name}</span></div>
        <div className="cursor-settings__playground" data-cursor-state={preview}>
          {skin ? <img className="cursor-settings__hero" src={skinImage(skin, preview)} alt={`${theme.name} · ${states.find(item => item.id === preview)!.label}状态预览`} /> : <span className="cursor-settings__live-sample" aria-hidden="true"><CursorSample theme={selected} /></span>}
          <p>{skin ? '造型换新，落点依旧准确' : selected === 'system' ? '选一套皮肤，移入这里体验' : '移动、停留，再轻轻点击'}</p>
          <button type="button" className="cursor-settings__try" data-cursor-label="试试" onClick={() => setClicks(value => value + 1)}>试试点击 <MoveUpRight size={16} /></button><span className="cursor-settings__clicks" aria-live="polite">{clicks ? `已响应 ${clicks} 次点击` : '等待第一次点击'}</span>
        </div>
        {skin && <div className="cursor-settings__states" aria-label="预览光标状态">{states.map(state => <button type="button" key={state.id} aria-pressed={preview === state.id} onClick={() => setPreview(state.id)} data-cursor-state={state.id}><img src={skinImage(skin, state.id)} alt="" /><span>{state.label}</span></button>)}</div>}
        <label className="cursor-settings__input">输入与选择文字<input placeholder="在这里试试中文输入与文字选择…" /></label>
        <p className="cursor-settings__trail-summary" aria-live="polite">拖尾：{cursorTrails.find(item=>item.id===trail)!.name}</p>
        <button type="button" className="cursor-settings__preview-reset" aria-label="恢复系统光标并关闭拖尾" onClick={()=>setError(!resetCursorPreferences())}>恢复默认</button>
      </div>
    </div>
    <footer className="cursor-settings__footer"><p role="status">{error ? '浏览器未允许保存设置，请检查存储权限后重试。' : `当前：${theme.name}。${theme.detail}。`}</p><p>光标与拖尾独立保存。「恢复全部默认」会使用系统光标并关闭拖尾。输入、文字选择和画布拖拽时暂停拖尾；触屏、高对比与减少动态效果模式不播放拖尾。</p><details><summary>设计参考</summary><p>箭头皮肤与奇幻角色为原创绘制，动态效果参考以下交互方向。</p><a href="https://tympanus.net/codrops/2023/06/07/gooey-cursor-effect/" target="_blank" rel="noreferrer">液态融合</a><a href="https://tympanus.net/codrops/2025/02/06/building-a-playful-stop-motion-crayon-cursor-in-p5-js/" target="_blank" rel="noreferrer">手绘蜡笔</a><a href="https://tympanus.net/codrops/2022/08/24/custom-svg-cursors-with-an-interactive-emitter-effect/" target="_blank" rel="noreferrer">波纹发射</a><a href="https://tympanus.net/codrops/2026/08/25/building-a-mouse-following-square-lens-effect-with-three-js-and-glsl/" target="_blank" rel="noreferrer">方形透镜</a><a href="https://cuberto.com/blog/cuberto-mouse-follower/" target="_blank" rel="noreferrer">语境跟随</a></details></footer>
  </section>
}
