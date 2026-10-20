// 网页无法读取操作系统指针尺寸；原生皮肤使用紧凑的 24px 基准。
export const cursorArtworkSize = 40
export const nativeCursorSize = 24
export const cursorRenderScale = nativeCursorSize / cursorArtworkSize

export function effectCursorScale(theme: string) {
  if (theme === 'dragon') return .3
  if (theme === 'quill') return .48
  return cursorRenderScale
}
