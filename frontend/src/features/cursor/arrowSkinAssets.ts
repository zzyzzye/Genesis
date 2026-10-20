import { cursorArtworkSize, cursorRenderScale, nativeCursorSize } from './sizing'

export const arrowSkinIds = ['crystal', 'obsidian', 'arcane', 'scales', 'cream'] as const
export type ArrowSkin = typeof arrowSkinIds[number]
export type SkinState = 'default' | 'pointer' | 'text' | 'grab' | 'disabled'
const materials: Record<ArrowSkin, { light: string; mid: string; dark: string; edge: string; accent: string }> = {
  crystal: { light: '#f1fbff', mid: '#9ed6ef', dark: '#9278d4', edge: '#526885', accent: '#fff' },
  obsidian: { light: '#a4acba', mid: '#3e4654', dark: '#111720', edge: '#b1bac8', accent: '#e1e8f0' },
  arcane: { light: '#ad92e3', mid: '#60508b', dark: '#332b51', edge: '#d4b575', accent: '#f5d797' },
  scales: { light: '#99d9c7', mid: '#329e91', dark: '#185f61', edge: '#b7954f', accent: '#f0cf7b' },
  cream: { light: '#fff9e9', mid: '#efd4b5', dark: '#dba6a1', edge: '#95776a', accent: '#fffdf7' },
}
export function isArrowSkin(value: string): value is ArrowSkin { return arrowSkinIds.some(id => id === value) }
const outlines: Record<SkinState, string> = {
  default: 'M5 3 L6 30 L13 23 L19 36 L25 33 L19 21 L30 20 Z',
  pointer: 'M14 19 V6 C14 2 20 2 20 6 V17 C22 14 26 16 26 19 C29 16 32 19 32 22 C35 20 37 23 36 27 L33 36 L18 36 L9 25 C6 21 10 18 14 23 Z',
  text: 'M12 4 H25 V8 H21 V31 H25 V35 H12 V31 H16 V8 H12 Z',
  grab: 'M10 19 V13 C10 9 15 9 15 13 V17 V9 C15 5 20 5 20 9 V17 V10 C20 6 25 6 25 10 V18 V14 C25 10 30 10 30 14 V24 L27 34 H13 L6 24 C4 20 8 17 10 21 Z',
  disabled: 'M19 4 A15 15 0 1 1 18.99 4 Z',
}
export function skinImage(skin: ArrowSkin, state: SkinState = 'default', size = cursorArtworkSize) {
  const m = materials[skin]
  const shape = skin === 'cream' && state === 'default' ? 'M5 3 Q6 3 8 5 L29 19 Q32 22 28 22 L20 22 L25 32 Q26 35 23 36 L21 37 Q19 38 18 35 L13 25 L8 30 Q5 33 5 29 Z' : outlines[state]
  const detail = skin === 'scales'
    ? `<path d="M1 10 Q6 17 11 10 Q16 17 21 10 Q26 17 31 10 M1 19 Q6 26 11 19 Q16 26 21 19 Q26 26 31 19 M1 28 Q6 35 11 28 Q16 35 21 28 Q26 35 31 28" fill="none" stroke="${m.accent}" stroke-width=".8"/>`
    : skin === 'cream'
      ? `<path d="M8 9 L9 23 M12 12 L24 20" fill="none" stroke="${m.accent}" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`
    : skin === 'arcane'
      ? `<path d="M11 12 L16 16 L12 20 M18 22 L22 27 L19 29 M13 17 L18 13" fill="none" stroke="${m.accent}" stroke-width="1.2"/>`
      : `<path d="M6 4 L15 20 L29 20 M15 20 L24 33 M6 4 L7 28 L15 20" fill="none" stroke="${m.accent}" stroke-width=".8" opacity=".6"/>`
  const art = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40"><defs><linearGradient id="material" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${m.light}"/><stop offset=".46" stop-color="${m.mid}"/><stop offset="1" stop-color="${m.dark}"/></linearGradient><clipPath id="shape"><path d="${shape}"/></clipPath></defs><path d="${shape}" fill="url(#material)" stroke="${m.edge}" stroke-width="1.2" stroke-linejoin="${skin === 'cream' ? 'round' : 'miter'}"/><g clip-path="url(#shape)">${detail}</g>${state === 'disabled' ? `<path d="M9 9 L29 29" stroke="${m.accent}" stroke-width="3"/>` : ''}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(art)}`
}
export function skinStyles(skin: ArrowSkin) {
  const cursor = (state: SkinState, fallback: string) => {
    const [x, y]: [number, number] = state === 'default' ? [5, 3] : state === 'pointer' ? [17, 5] : [19, 19]
    return `url("${skinImage(skin, state, nativeCursorSize)}") ${Math.round(x * cursorRenderScale)} ${Math.round(y * cursorRenderScale)}, ${fallback}`
  }
  const scope = `html[data-genesis-skin="${skin}"]`
  return `
    @media (any-pointer: fine) and (forced-colors: none) {
      ${scope} { cursor: ${cursor('default', 'default')}; }
      ${scope} :is(button, a, summary, [role="button"], [data-cursor-state="pointer"]):not(:disabled):not([aria-disabled="true"]) { cursor: ${cursor('pointer', 'pointer')} !important; }
      ${scope} :is(input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"], .cm-content, [data-cursor-state="text"]):not(:disabled):not([aria-disabled="true"]) { cursor: ${cursor('text', 'text')} !important; }
      ${scope} :is([draggable="true"], .react-flow__pane, .react-flow__node, [data-cursor-state="grab"]) { cursor: ${cursor('grab', 'grab')} !important; }
      ${scope} :is(button:disabled, input:disabled, textarea:disabled, [aria-disabled="true"], [data-cursor-state="disabled"]) { cursor: ${cursor('disabled', 'not-allowed')} !important; }
      ${scope} [data-cursor-state="default"] { cursor: ${cursor('default', 'default')} !important; }
    }
  `
}
