import { useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { Variants } from 'motion/react'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(listener: () => void) {
  const media = window.matchMedia?.(reducedMotionQuery)
  media?.addEventListener?.('change', listener)
  return () => media?.removeEventListener?.('change', listener)
}

function readReducedMotion() { return window.matchMedia?.(reducedMotionQuery).matches ?? false }

// Motion 的 hook 只读取初始偏好；导读需要响应阅读中的设置切换，及时停止打字。
export function useLiveReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => true)
}

// 布局变化保留起步过程，避免强减速曲线在前几帧就完成大部分位移。
const layoutEase = [0.4, 0, 0.2, 1] as const

export const motionTiming = {
  quick: 0.2,
  page: 0.32,
  ease: layoutEase,
  panel: 0.36,
  assistant: 0.44,
  assistantEase: layoutEase,
  studioEnter: 0.36,
  studioExit: 0.24,
  articleGuide: 0.44,
  articleGuideEase: [0.25, 0.1, 0.25, 1] as const,
  blogSidebar: 0.36,
}

// CSS 浮层与组件动效消费同一组时序，不在各页面重复维护布局缓动。
export const motionCssVariables = {
  '--motion-panel-duration': `${motionTiming.panel}s`,
  '--motion-layout-ease': `cubic-bezier(${layoutEase.join(',')})`,
} as CSSProperties

export const pageTransition: Variants = {
  initial: { opacity: 0 },
  enter: {
    opacity: 1,
    transition: {
      duration: motionTiming.page,
      ease: motionTiming.ease,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: motionTiming.quick,
      ease: motionTiming.ease,
    },
  },
}

// 工作台先完成旧视图退场，再让新视图从下方进入，编辑状态由外层持有。
export const studioWorkspaceTransition: Variants = {
  initial: { opacity: 0, y: 16 },
  enter: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTiming.studioEnter, ease: motionTiming.ease },
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: { duration: motionTiming.studioExit, ease: motionTiming.ease },
  },
}
