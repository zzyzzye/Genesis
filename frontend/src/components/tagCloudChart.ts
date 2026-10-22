import { init, use as registerECharts } from 'echarts/core'
import { TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import 'echarts-wordcloud'
import { tagColorIndex } from './tagCloudPalette'

registerECharts([SVGRenderer, TooltipComponent])

export type CloudTag = { id: string; name: string; count: number }

export function createCloudChart(element: HTMLDivElement) {
  return init(element, undefined, { renderer: 'svg' })
}

export function cloudOption({ items, label, selectedId, highlightedId, maximum, compact, disabled, reducedMotion, style }: {
  items: CloudTag[]
  label: string
  selectedId?: string
  highlightedId?: string | null
  maximum: number
  compact: boolean
  disabled: boolean
  reducedMotion: boolean
  style: CSSStyleDeclaration
}): EChartsOption {
  const ink = style.getPropertyValue('--tag-cloud-ink').trim() || '#151515'
  const hover = style.getPropertyValue('--tag-cloud-hover').trim() || '#ededed'
  const paper = style.getPropertyValue('--tag-cloud-paper').trim() || '#fff'
  const minimumSize = Number.parseFloat(style.getPropertyValue('--tag-cloud-min-size')) || 14
  const maximumSize = Number.parseFloat(style.getPropertyValue('--tag-cloud-max-size')) || 34
  const series = {
    id: 'tag-cloud',
    type: 'wordCloud' as const,
    name: label,
    shape: 'circle',
    left: 'center',
    top: 'center',
    width: '94%',
    height: '90%',
    gridSize: compact ? 8 : 12,
    rotationRange: [0, 0],
    drawOutOfBound: false,
    shrinkToFit: true,
    keepAspect: items.length <= 8,
    layoutAnimation: !reducedMotion,
    animation: !reducedMotion,
    silent: disabled,
    textStyle: { fontFamily: style.fontFamily, fontWeight: 600 },
    emphasis: { disabled, focus: 'self' as const, textStyle: { backgroundColor: hover, borderRadius: 4, padding: [2, 3], textShadowBlur: 0 } },
    blur: { textStyle: { opacity: 0.45 } },
    data: items.map(item => {
      const count = Math.max(0, item.count)
      const weight = Math.log1p(count) / Math.log1p(maximum)
      const active = selectedId === item.id || highlightedId === item.id
      const characters = Array.from(item.name)
      const limit = compact ? 12 : 24
      const fontSize = minimumSize + (maximumSize - minimumSize) * weight
      const color = style.getPropertyValue(`--tag-cloud-color-${tagColorIndex(item.name)}`).trim() || ink
      return {
        id: item.id,
        name: characters.length > limit ? `${characters.slice(0, limit - 1).join('')}…` : item.name,
        value: count,
        textStyle: {
          // 固定每个词的字号，避免搜索或显示更多时被局部数据重新缩放。
          fontSize,
          color,
          backgroundColor: active ? hover : 'transparent',
          borderRadius: 4,
          padding: [2, 3],
        },
        emphasis: { textStyle: { color, fontSize: fontSize * 1.12 } },
      }
    }),
  }

  return {
    animation: !reducedMotion,
    stateAnimation: { duration: reducedMotion ? 0 : 240, easing: 'cubicOut' },
    tooltip: {
      trigger: 'item',
      confine: true,
      borderWidth: 0,
      backgroundColor: paper,
      textStyle: { color: ink, fontSize: 12 },
      extraCssText: 'box-shadow:none;max-width:min(260px,calc(100% - 16px));white-space:normal;overflow-wrap:anywhere;',
      formatter: params => {
        const current = Array.isArray(params) ? params[0] : params
        const item = current ? items[current.dataIndex] : undefined
        const content = document.createElement('div')
        // 用 textContent 呈现名称，标签中的 HTML 不进入提示层。
        content.textContent = item ? `${item.name} · ${Math.max(0, item.count)} 篇文章` : ''
        return content
      },
    },
    series: [series],
  }
}
