import type { Variants } from 'motion/react'

export const motionTiming = {
  quick: 0.14,
  page: 0.2,
  ease: [0.22, 1, 0.36, 1] as const,
  assistant: 0.36,
  assistantEase: [0.25, 0.8, 0.25, 1] as const,
  studioEnter: 0.28,
  studioExit: 0.18,
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
