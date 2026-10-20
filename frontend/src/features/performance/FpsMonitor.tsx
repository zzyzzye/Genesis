import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type Stats from 'stats.js'
import { useFpsEnabled } from './preferences'
import './FpsMonitor.css'

let statsModule: Promise<typeof Stats> | undefined

function loadStats() {
  // 复用并发加载，失败后允许重新开启重试。
  statsModule ??= import('stats.js').then(module => module.default).catch((error: unknown) => {
    statsModule = undefined
    throw error
  })
  return statsModule
}

function createCounter(StatsConstructor: typeof Stats, onFps: (value: number) => void) {
  const originalPanel = StatsConstructor.Panel
  // 库只通过 Panel.update 暴露读数：替换绘制适配，计数仍由 stats.js 完成。
  StatsConstructor.Panel = class {
    dom = document.createElement('canvas')

    constructor(private readonly name: string) {}

    update(value: number) {
      if (this.name === 'FPS') onFps(value)
    }
  }
  try {
    return new StatsConstructor()
  } finally {
    // 构造过程同步完成，立即还原，避免影响其他库使用者。
    StatsConstructor.Panel = originalPanel
  }
}

function ActiveFpsMonitor() {
  const host = useRef<HTMLDivElement>(null)
  const reading = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const container = host.current!
    const selector = '.studio-assistant, .media-agent'
    let assistant: Element | null = null

    function position() {
      const bounds = assistant?.getBoundingClientRect()
      // 助手占满屏幕时让出输入区域；其他情况贴在它左侧的页面底边。
      container.classList.toggle('is-occluded', !!bounds?.width && bounds.left < 94)
      const right = bounds?.width ? window.innerWidth - bounds.left + 12 : 16
      container.style.setProperty('--fps-right', `${right}px`)
    }

    const resize = new ResizeObserver(position)
    function reconnect() {
      const next = document.querySelector(selector)
      if (next !== assistant) {
        resize.disconnect()
        assistant = next
        if (assistant) resize.observe(assistant)
      }
      position()
    }
    // 只响应助手容器的增删，正文流式输出和 FPS 数字变化不触发布局读取。
    const mutations = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element && (node.matches(selector) || node.querySelector(selector)),
      ))) reconnect()
    })
    mutations.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
    window.addEventListener('resize', position)
    reconnect()
    return () => {
      mutations.disconnect()
      resize.disconnect()
      window.removeEventListener('resize', position)
    }
  }, [])

  useEffect(() => {
    const container = host.current!
    const value = reading.current!
    let disposed = false
    let frame: number | null = null
    let teardown: (() => void) | undefined

    // 关闭时不加载库；等待加载期间关闭，也不能启动遗留循环。
    void loadStats().then(Stats => {
      if (disposed) return

      function stop() {
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
        value.textContent = '—'
        container.hidden = true
      }

      function restart() {
        stop()
        if (document.hidden) return

        // 恢复可见时重建计时基线，后台时间不计入 FPS。
        const stats = createCounter(Stats, fps => {
          value.textContent = String(Math.round(fps))
        })
        container.hidden = false

        function tick() {
          stats.update()
          frame = requestAnimationFrame(tick)
        }

        frame = requestAnimationFrame(tick)
      }

      document.addEventListener('visibilitychange', restart)
      teardown = () => {
        document.removeEventListener('visibilitychange', restart)
        stop()
      }
      restart()
    }).catch(() => {
      if (disposed) return
      teardown?.()
      teardown = undefined
      container.hidden = false
      value.textContent = '不可用'
      container.title = 'FPS 加载失败，请关闭后重试'
    })

    return () => {
      disposed = true
      teardown?.()
      value.textContent = '—'
    }
  }, [])

  return createPortal(<div
    ref={host}
    hidden
    className="fps-monitor"
    role="group"
    aria-label="实时 FPS"
    title="动画回调 FPS"
  ><span ref={reading} className="fps-monitor__value">—</span><span className="fps-monitor__unit">FPS</span></div>, document.body)
}

export function FpsMonitor() {
  return useFpsEnabled() ? <ActiveFpsMonitor /> : null
}
