import { useCallback, useEffect, useEffectEvent, useId, useRef, useState, type CSSProperties } from 'react'
import { animate } from 'motion/react'
import type { EChartsType } from 'echarts/core'
import type { CloudTag } from './tagCloudChart'
import { useLiveReducedMotion } from '../lib/motion'
import { tagColorIndex } from './tagCloudPalette'
import './TagCloud.css'

export function TagCloud({ items, label, onSelect, itemLabel, selectedId, highlightedId, compact = false, disabled = false, opensDialog = false, maximumCount, buttonRef }: {
  items: CloudTag[]
  label: string
  onSelect: (id: string) => void
  itemLabel?: (item: CloudTag) => string
  selectedId?: string
  highlightedId?: string | null
  compact?: boolean
  disabled?: boolean
  opensDialog?: boolean
  maximumCount?: number
  buttonRef?: (id: string, element: HTMLButtonElement | null) => void
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const scene = useRef<HTMLDivElement>(null)
  const drift = useRef<Animation | null>(null)
  const acceleration = useRef<{ stop: () => void } | null>(null)
  const chart = useRef<EChartsType | null>(null)
  const renderer = useRef<typeof import('./tagCloudChart') | null>(null)
  const [ready, setReady] = useState(false)
  const reducedMotion = useLiveReducedMotion()
  // 对数缩放避免高频标签挤占空间；管理页可传入全量上限，搜索不改变字号。
  const maximum = Math.max(2, maximumCount ?? 0, ...items.map(item => Math.max(0, item.count)))
  const signature = JSON.stringify([items, maximum, label, compact, selectedId, highlightedId, disabled, reducedMotion])
  const height = !items.length ? 0 : compact ? Math.max(140, Math.min(280, 80 + items.length * 9)) : Math.max(180, Math.min(420, 120 + items.length * 7))

  const changeSpeed = useCallback((moving: boolean) => {
    const animation = drift.current
    if (!animation) return
    acceleration.current?.stop()
    // 只改变时间流速，暂停与恢复都沿原轨迹继续，不重置位置。
    acceleration.current = animate(animation.playbackRate, moving ? 1 : 0, {
      duration: 0.8,
      ease: 'easeInOut',
      onUpdate: speed => animation.updatePlaybackRate(speed),
    })
  }, [])

  useEffect(() => {
    const element = scene.current
    if (!ready || reducedMotion || !element?.animate) return
    // 浏览器沿连续椭圆移动整幅图，不修改单词布局或 ECharts 的点击坐标。
    const animation = element.animate({ offsetDistance: ['0%', '100%'] }, { duration: 24000, iterations: Infinity, easing: 'linear' })
    drift.current = animation
    return () => {
      acceleration.current?.stop()
      animation.cancel()
      drift.current = null
    }
  }, [ready, reducedMotion])

  useEffect(() => {
    changeSpeed(!disabled && !root.current?.matches(':hover, :focus-within'))
  }, [changeSpeed, ready, disabled, reducedMotion])

  const selectWord = useEffectEvent((event: unknown) => {
    if (disabled || !event || typeof event !== 'object' || !('dataIndex' in event) || typeof event.dataIndex !== 'number') return
    const item = items[event.dataIndex]
    if (item) onSelect(item.id)
  })

  const draw = useEffectEvent(() => {
    if (!root.current || !canvas.current || !renderer.current || !canvas.current.clientWidth || !canvas.current.clientHeight) return
    if (!chart.current) {
      chart.current = renderer.current.createCloudChart(canvas.current)
      chart.current.on('click', (event: unknown) => selectWord(event))
    }
    chart.current.setOption(renderer.current.cloudOption({ items, label, selectedId, highlightedId, maximum, compact, disabled, reducedMotion, style: getComputedStyle(root.current) }), { lazyUpdate: true })
    setReady(true)
  })

  useEffect(() => {
    const element = canvas.current
    // 无 Canvas 的环境保留原生按钮，图表模块只在浏览器需要时加载。
    if (!element || typeof CanvasRenderingContext2D === 'undefined') return
    let cancelled = false
    let observer: ResizeObserver | undefined
    let timer = 0
    void import('./tagCloudChart').then(module => {
      if (cancelled) return
      renderer.current = module
      draw()
      let width = element.clientWidth
      let height = element.clientHeight
      observer = new ResizeObserver(() => {
        if (width === element.clientWidth && height === element.clientHeight) return
        width = element.clientWidth; height = element.clientHeight
        clearTimeout(timer)
        // 等侧栏伸缩稳定后再重新排词，避免每一帧都重新计算布局。
        timer = window.setTimeout(() => {
          if (!element.clientWidth || !element.clientHeight) return
          if (chart.current) chart.current.resize()
          else draw()
        }, 100)
      })
      observer.observe(element)
    }).catch(() => { /* 加载失败时继续使用完整、可操作的标签列表。 */ })
    return () => {
      cancelled = true
      clearTimeout(timer)
      observer?.disconnect()
      chart.current?.dispose()
      chart.current = null
      renderer.current = null
    }
  }, [])

  useEffect(() => { draw() }, [signature])

  function focusWord(index: number, focused: boolean) {
    chart.current?.dispatchAction({ type: focused ? 'highlight' : 'downplay', seriesIndex: 0, dataIndex: index })
    chart.current?.dispatchAction({ type: focused ? 'showTip' : 'hideTip', seriesIndex: 0, dataIndex: index })
  }

  return <div ref={root} className={`tag-cloud${compact ? ' tag-cloud--compact' : ''}${ready ? ' tag-cloud--ready' : ''}`} style={{ '--tag-cloud-height': `${height}px` } as CSSProperties}
    onPointerEnter={() => changeSpeed(false)}
    onPointerLeave={() => { if (!disabled && !root.current?.contains(document.activeElement)) changeSpeed(true) }}
    onFocusCapture={() => changeSpeed(false)}
    onBlurCapture={event => { if (!disabled && !event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(':hover')) changeSpeed(true) }}
  >
    <div ref={scene} className="tag-cloud__scene"><div ref={canvas} className="tag-cloud__chart" aria-hidden="true" /></div>
    <ul className="tag-cloud__list" aria-label={label}>
    {items.map((item, index) => {
      const count = Math.max(0, item.count)
      const weight = Math.log1p(count) / Math.log1p(maximum)
      const countId = `${id}-count-${index}`
      return <li key={item.id} style={{ '--tag-cloud-weight': weight, '--tag-cloud-word-color': `var(--tag-cloud-color-${tagColorIndex(item.name)})` } as CSSProperties}>
        <button
          ref={element => buttonRef?.(item.id, element)}
          type="button"
          className={`tag-cloud__word${highlightedId === item.id ? ' is-highlighted' : ''}`}
          aria-label={itemLabel?.(item) ?? item.name}
          aria-describedby={countId}
          aria-pressed={selectedId === undefined ? undefined : selectedId === item.id}
          aria-haspopup={opensDialog ? 'dialog' : undefined}
          title={`${item.name} · ${count} 篇文章`}
          disabled={disabled}
          onClick={() => onSelect(item.id)}
          onFocus={() => focusWord(index, true)}
          onBlur={() => focusWord(index, false)}
        >
          <span className="tag-cloud__name">{item.name}</span>
          <span className="tag-cloud__count" id={countId}>{count}<span className="sr-only"> 篇文章</span></span>
        </button>
      </li>
    })}
    </ul>
  </div>
}
