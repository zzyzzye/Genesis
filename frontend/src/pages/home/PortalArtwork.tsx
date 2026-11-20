import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'

type PortalKind = 'journal' | 'lab' | 'studio'

/** 入口采用纯粹的流线与波形，时钟只驱动图形，文字与点击范围保持稳定。 */
export function PortalArtwork({ kind, reducedMotion, paused }: { kind: PortalKind; reducedMotion: boolean; paused: boolean }) {
  const objectRef = useRef<HTMLSpanElement>(null)
  const phase = useMotionValue(0)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const rotateX = useSpring(x, { stiffness: 100, damping: 22 })
  const rotateY = useSpring(y, { stiffness: 100, damping: 22 })
  useEffect(() => {
    if (reducedMotion) phase.set(0)
    const element = objectRef.current
    if (!element || paused || reducedMotion || typeof IntersectionObserver === 'undefined') return
    const animation = animate(phase, phase.get() + Math.PI * 2, { duration: kind === 'journal' ? 7 : kind === 'lab' ? 12 : 9, ease: 'linear', repeat: Infinity })
    let visible = false
    const sync = () => { if (visible && !document.hidden) animation.play(); else animation.pause() }
    animation.pause()
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync() })
    observer.observe(element)
    document.addEventListener('visibilitychange', sync)
    return () => { animation.stop(); observer.disconnect(); document.removeEventListener('visibilitychange', sync) }
  }, [kind, paused, phase, reducedMotion])

  return <motion.span ref={objectRef} className="home-portal-object" aria-hidden="true"
    style={{ rotateX: reducedMotion ? 0 : rotateX, rotateY: reducedMotion ? 0 : rotateY, transformPerspective: 650 }}
    onPointerMove={event => {
      if (reducedMotion || event.pointerType !== 'mouse') return
      const rect = event.currentTarget.getBoundingClientRect()
      x.set((.5 - (event.clientY - rect.top) / rect.height) * 14)
      y.set(((event.clientX - rect.left) / rect.width - .5) * 18)
    }} onPointerLeave={() => { x.set(0); y.set(0) }}>
    <svg viewBox="0 0 260 260" fill="none" aria-hidden="true">
      {Array.from({ length: kind === 'lab' ? 7 : 11 }, (_, index) => <AbstractTrace key={index} kind={kind} index={index} phase={phase} />)}
    </svg>
  </motion.span>
}

function AbstractTrace({ kind, index, phase }: { kind: PortalKind; index: number; phase: MotionValue<number> }) {
  const path = useTransform(phase, time => {
    const points = Array.from({ length: kind === 'lab' ? 161 : 101 }, (_, sample) => {
      const progress = sample / (kind === 'lab' ? 160 : 100)
      const angle = progress * Math.PI * 2
      if (kind === 'journal') {
        const x = 24 + progress * 212
        const y = 130 + (index - 5) * 9 + Math.sin(progress * Math.PI * 2 + time + index * .19) * 26 * Math.sin(progress * Math.PI)
        return [x, y]
      }
      if (kind === 'lab') {
        return [130 + Math.sin(angle * 3 + time) * (79 - index * 4), 130 + Math.sin(angle * 2 + index * .12) * (75 - index * 3)]
      }
      const radius = 46 + index * 4 + Math.sin(angle * 3 + time + index * .18) * 14
      return [130 + Math.cos(angle) * radius, 130 + Math.sin(angle) * radius * .85]
    })
    return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x!.toFixed(2)},${y!.toFixed(2)}`).join(' ') + (kind === 'journal' ? '' : 'Z')
  })
  return <motion.path className="portal-abstract-trace" d={path} stroke="currentColor" strokeWidth={index % 5 === 0 ? 1.4 : .75} strokeOpacity={.3 + index % 4 * .16} />
}
