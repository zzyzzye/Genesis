import { useSyncExternalStore } from 'react'

export const cursorThemes = [
  { id: 'system', name: '系统默认', detail: '使用浏览器原生光标', signature: '原生 · 精准' },
  { id: 'crystal', name: '水晶箭头', detail: '蓝紫晶体切面，配套手型、文本、拖拽与禁用光标', signature: '通透 · 冷光' },
  { id: 'obsidian', name: '黑曜石箭头', detail: '深色金属与细银刃口，配套完整操作光标', signature: '金属 · 银刃' },
  { id: 'arcane', name: '魔法箭头', detail: '紫色箭身嵌入金色符文，配套完整操作光标', signature: '符文 · 鎏金' },
  { id: 'scales', name: '龙鳞箭头', detail: '青金鳞片包覆箭身，配套完整操作光标', signature: '青金 · 鳞纹' },
  { id: 'cream', name: '奶油箭头', detail: '柔和奶杏与圆润轮廓，配套完整操作光标', signature: '奶杏 · 柔软' },
  { id: 'gooey', name: '液态融合', detail: '柔软墨团随移动融合，点击分裂再聚合', signature: '融合 · 分裂' },
  { id: 'crayon', name: '手绘蜡笔', detail: '带颗粒的手绘笔尖，按住空白处留下短暂笔迹', signature: '笔触 · 纸感' },
  { id: 'emitter', name: '波纹发射', detail: '沿移动路径释放细线波纹，点击激起涟漪', signature: '波纹 · 扩散' },
  { id: 'lens', name: '方形透镜', detail: '磨砂透镜跟随指针，悬停舒展，点击轻压', signature: '磨砂 · 明暗' },
  { id: 'follower', name: '语境跟随', detail: '随速度拉伸，靠近操作切换提示，拖动时收紧', signature: '磁吸 · 形变' },
  { id: 'quill', name: '魔法羽毛笔', detail: '蓝紫羽毛随移动轻摆，悬停亮起金色羽轴，点击落下符文', signature: '羽光 · 符文' },
  { id: 'starlight', name: '星灵', detail: '星环环绕金色星核，移动留下星尘，点击展开星座', signature: '星环 · 星座' },
  { id: 'dragon', name: '游龙', detail: '青金小龙随指针游动，悬停扬起龙角，点击吐出火花', signature: '青鳞 · 流焰' },
] as const
export type CursorTheme = typeof cursorThemes[number]['id']
export const cursorPreferenceKey = 'genesis.cursor-theme.v1'
export const cursorTrails = [
  { id: 'none', name: '无拖尾', detail: '保持干净的指针' },
  { id: 'silk', name: '流光丝带', detail: '细丝沿移动轨迹逐渐淡出' },
  { id: 'dust', name: '星尘微光', detail: '散落细小的金紫星芒' },
  { id: 'ripple', name: '涟漪轨迹', detail: '细圈沿路径舒展消散' },
] as const
export type CursorTrailStyle = typeof cursorTrails[number]['id']
export const cursorTrailKey = 'genesis.cursor-trail.v1'
const changedEvent = 'genesis:cursor-theme'

export function readCursorTheme(): CursorTheme {
  try {
    const value = localStorage.getItem(cursorPreferenceKey)
    return cursorThemes.find(theme => theme.id === value)?.id ?? 'system'
  } catch { return 'system' }
}

export function saveCursorTheme(theme: CursorTheme): boolean {
  try {
    localStorage.setItem(cursorPreferenceKey, theme)
    window.dispatchEvent(new Event(changedEvent))
    return true
  } catch { return false }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === cursorPreferenceKey || event.key === cursorTrailKey || event.key === null) listener()
  }
  window.addEventListener(changedEvent, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(changedEvent, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useCursorTheme() {
  return useSyncExternalStore(subscribe, readCursorTheme, () => 'system' as const)
}

export function readCursorTrail(): CursorTrailStyle {
  try { return cursorTrails.find(item => item.id === localStorage.getItem(cursorTrailKey))?.id ?? 'none' }
  catch { return 'none' }
}

export function saveCursorTrail(style: CursorTrailStyle): boolean {
  try { localStorage.setItem(cursorTrailKey, style); window.dispatchEvent(new Event(changedEvent)); return true }
  catch { return false }
}

export function useCursorTrail() {
  return useSyncExternalStore(subscribe, readCursorTrail, () => 'none' as const)
}

export function resetCursorPreferences(): boolean {
  let previousTheme: string | null = null, previousTrail: string | null = null
  let captured = false
  try {
    previousTheme = localStorage.getItem(cursorPreferenceKey)
    previousTrail = localStorage.getItem(cursorTrailKey)
    captured = true
    localStorage.removeItem(cursorPreferenceKey)
    localStorage.removeItem(cursorTrailKey)
    window.dispatchEvent(new Event(changedEvent))
    return true
  } catch {
    if (captured) {
      try {
        if (previousTheme !== null) localStorage.setItem(cursorPreferenceKey, previousTheme)
        if (previousTrail !== null) localStorage.setItem(cursorTrailKey, previousTrail)
      } catch { /* 让订阅者读取实际存储状态，错误提示继续保留。 */ }
    }
    window.dispatchEvent(new Event(changedEvent))
    return false
  }
}
