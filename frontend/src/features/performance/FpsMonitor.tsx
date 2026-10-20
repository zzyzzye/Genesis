import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
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

const StatusTarget = createContext<Dispatch<SetStateAction<HTMLSpanElement | null>> | null>(null)

/** 页头显式提供状态位置，不测量或追踪其他页面控件。 */
export function FpsStatusSlot() {
  const setTarget = useContext(StatusTarget)
  const register = useCallback((node: HTMLSpanElement | null) => {
    if (!node || !setTarget) return
    setTarget(node)
    return () => setTarget(current => current === node ? null : current)
  }, [setTarget])
  return <span className="fps-status-slot" ref={register} />
}

function ActiveFpsMonitor({ target }: { target: HTMLSpanElement | null }) {
  const [reading, setReading] = useState('—')
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let disposed = false
    let frame: number | null = null
    let teardown: (() => void) | undefined

    // 关闭时不加载库；等待加载期间关闭，也不能启动遗留循环。
    void loadStats().then(Stats => {
      if (disposed) return

      function stop() {
        if (frame !== null) cancelAnimationFrame(frame)
        frame = null
        setReading('—')
        setVisible(false)
      }

      function restart() {
        stop()
        if (document.hidden) return

        // 恢复可见时重建计时基线，后台时间不计入 FPS。
        const stats = createCounter(Stats, fps => {
          setReading(String(Math.round(fps)))
        })
        setVisible(true)

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
      setVisible(true)
      setReading('不可用')
    })

    return () => {
      disposed = true
      teardown?.()
    }
  }, [])

  return target ? createPortal(<span
    hidden={!visible}
    className="fps-monitor"
    role="group"
    aria-label="实时 FPS"
    title={reading === '不可用' ? 'FPS 加载失败，请关闭后重试' : '动画回调 FPS'}
  ><span className="fps-monitor__value">{reading}</span><span className="fps-monitor__unit">FPS</span></span>, target) : null
}

export function FpsMonitor({ children }: { children?: ReactNode }) {
  const [target, setTarget] = useState<HTMLSpanElement | null>(null)
  const enabled = useFpsEnabled()
  return <StatusTarget.Provider value={setTarget}>
    {children}
    {enabled && <ActiveFpsMonitor target={target} />}
  </StatusTarget.Provider>
}
