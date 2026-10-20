import { useSyncExternalStore } from 'react'
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

export const motionTiming = {
  quick: 0.14,
  page: 0.2,
  ease: [0.22, 1, 0.36, 1] as const,
  assistant: 0.36,
  assistantEase: [0.25, 0.8, 0.25, 1] as const,
  studioEnter: 0.28,
  studioExit: 0.18,
  articleGuide: 0.44,
  articleGuideEase: [0.25, 0.1, 0.25, 1] as const,
}

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
