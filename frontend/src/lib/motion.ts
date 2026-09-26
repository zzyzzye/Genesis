import type { Variants } from 'motion/react'

export const motionTiming = {
  quick: 0.14,
  page: 0.2,
  ease: [0.22, 1, 0.36, 1] as const,
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
