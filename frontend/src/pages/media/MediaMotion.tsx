import type { RefObject } from 'react'
import { motion, useIsPresent, type HTMLMotionProps } from 'motion/react'
import { mediaNavigationTransition, mediaSurfaceTransition, pageTransition, useLiveReducedMotion } from '../../lib/motion'
import { useModalDialog } from '../../studio/useModalDialog'
import './MediaMotion.css'

/** 保留退场画面，但立即移除键盘、鼠标与辅助技术交互。 */
export function MediaSurface({ fadeOnly = false, ...props }: HTMLMotionProps<'div'> & { fadeOnly?: boolean }) {
  const present = useIsPresent()
  const reduced = useLiveReducedMotion()
  return <motion.div {...props} inert={!present} aria-hidden={!present || undefined}
    variants={fadeOnly ? pageTransition : mediaSurfaceTransition}
    initial={reduced ? false : 'initial'} animate={reduced ? { opacity: 1, ...(fadeOnly ? {} : { y: 0 }), transition: { duration: 0 } } : 'enter'}
    exit={reduced ? { opacity: 0, transition: { duration: 0 } } : 'exit'} />
}

/** 模态焦点仍由共享 hook 管理，等待 Motion 退场完成后再释放顶层。 */
export function MediaDialog({ initialFocus, navigation = false, ...props }: HTMLMotionProps<'dialog'> & { initialFocus?: RefObject<HTMLElement | null>; navigation?: boolean }) {
  const dialog = useModalDialog(initialFocus)
  const present = useIsPresent()
  const reduced = useLiveReducedMotion()
  return <motion.dialog {...props} ref={dialog} inert={!present} aria-hidden={!present || undefined}
    data-media-dialog="" data-exiting={!present || undefined} variants={navigation ? mediaNavigationTransition : mediaSurfaceTransition}
    initial={reduced ? false : 'initial'} animate={reduced ? { opacity: 1, x: 0, y: 0, transition: { duration: 0 } } : 'enter'}
    exit={reduced ? { opacity: 0, transition: { duration: 0 } } : 'exit'} />
}
