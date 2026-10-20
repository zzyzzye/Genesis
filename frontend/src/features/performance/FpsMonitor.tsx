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

function ActiveFpsMonitor() {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = host.current!
    let disposed = false
    let frame: number | null = null
    let teardown: (() => void) | undefined

    // 关闭时不加载库；等待加载期间关闭，也不能启动遗留循环。
    void loadStats().then(Stats => {
      if (disposed) return

      function stop() {
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
        container.replaceChildren()
        container.hidden = true
      }

      function restart() {
        stop()
        if (document.hidden) return

        // 恢复可见时重建计时基线，后台时间不计入 FPS。
        const stats = new Stats()
        stats.showPanel(0)
        stats.dom.style.cssText = ''
        container.replaceChildren(stats.dom)
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
      container.textContent = 'FPS 加载失败，请关闭后重试'
    })

    return () => {
      disposed = true
      teardown?.()
      container.replaceChildren()
    }
  }, [])

  return createPortal(<div
    ref={host}
    hidden
    className="fps-monitor"
    role="img"
    aria-label="实时 FPS 帧率图"
    title="动画回调 FPS"
  />, document.body)
}

export function FpsMonitor() {
  return useFpsEnabled() ? <ActiveFpsMonitor /> : null
}
