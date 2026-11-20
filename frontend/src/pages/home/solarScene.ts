/** 按本地钟表时间编排的艺术化昼夜，不使用定位或冒充天文计算。 */
export function solarScene(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440
  const angle = (normalized / 60 - 6) / 12 * Math.PI
  const elevation = Math.sin(angle)
  return {
    angle,
    elevation,
    daylight: Math.max(0, elevation),
    twilight: Math.exp(-Math.pow(elevation / .28, 2)),
    label: normalized < 330 || normalized >= 1170 ? '夜晚' : normalized < 450 ? '晨光' : normalized < 1020 ? '白昼' : '暮色',
    time: `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(Math.floor(normalized % 60)).padStart(2, '0')}`,
  }
}
