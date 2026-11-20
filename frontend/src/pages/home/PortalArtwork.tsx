import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react'

type PortalKind = 'journal' | 'lab' | 'studio'

/** 图形随指针轻微倾斜，文字与点击区域保持稳定；触屏无需拖动。 */
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
    // 每个物体共用一个连续相位，暂停保留姿态，恢复不跳回首帧。
    const animation = animate(phase, phase.get() + Math.PI * 2, { duration: kind === 'journal' ? 5 : kind === 'lab' ? 12 : 9, ease: 'linear', repeat: Infinity })
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
      x.set((.5 - (event.clientY - rect.top) / rect.height) * 22)
      y.set(((event.clientX - rect.left) / rect.width - .5) * 28)
    }} onPointerLeave={() => { x.set(0); y.set(0) }}>
    <Artwork kind={kind} phase={phase} />
  </motion.span>
}

/** 静态 SVG 在无 Canvas 和减少动画时仍完整可用。 */
function Artwork({ kind, phase }: { kind: PortalKind; phase: MotionValue<number> }) {
  const float = useTransform(phase, value => Math.sin(value) * 9)
  const orbit = useTransform(phase, value => value * 180 / Math.PI)
  const counterOrbit = useTransform(phase, value => -value * 180 / Math.PI * 2)
  const cube = useTransform(phase, value => crystalPath(value, 76))
  const innerCube = useTransform(phase, value => crystalPath(-value, 39))
  if (kind === 'journal') return <svg viewBox="0 0 260 260" fill="none" aria-hidden="true">
    <defs><linearGradient id="portal-paper" x1="60" y1="60" x2="190" y2="210" gradientUnits="userSpaceOnUse"><stop stopColor="#fff4dd" stopOpacity=".5" /><stop offset="1" stopColor="#ad815d" stopOpacity=".04" /></linearGradient><linearGradient id="portal-paper-edge"><stop stopColor="#f5e5ce" /><stop offset="1" stopColor="#9c765b" /></linearGradient></defs>
    <ellipse cx="130" cy="156" rx="113" ry="53" transform="rotate(-25 130 156)" stroke="#b89e80" strokeOpacity=".3" strokeDasharray="2 7" />
    <motion.g className="portal-paper-stack" style={{ y: float }}>
      {[26, 13, 0].map(offset => <PaperLayer key={offset} offset={offset} phase={phase} />)}
    </motion.g>
    <circle cx="37" cy="188" r="3" fill="#e5c7a1" /><path d="M207 61v16m-8-8h16" stroke="#eee0ce" strokeOpacity=".75" />
  </svg>
  if (kind === 'lab') return <svg viewBox="0 0 260 260" fill="none" aria-hidden="true">
    <defs><linearGradient id="portal-crystal" x1="50" y1="40" x2="210" y2="220" gradientUnits="userSpaceOnUse"><stop stopColor="#bff3ee" stopOpacity=".35" /><stop offset=".5" stopColor="#659fbd" stopOpacity=".07" /><stop offset="1" stopColor="#b7e1ea" stopOpacity=".25" /></linearGradient></defs>
    <ellipse cx="130" cy="168" rx="112" ry="46" stroke="#a1d2d6" strokeOpacity=".2" transform="rotate(16 130 168)" />
    <motion.g className="portal-crystal" style={{ y: float }}>
      <motion.path className="portal-crystal-shell" d={cube} fill="url(#portal-crystal)" stroke="#c5edf1" strokeOpacity=".85" />
      <motion.path d={innerCube} stroke="#d9fcff" strokeOpacity=".7" />
      <path d="m130 96 28 32-28 33-28-33Z" fill="#b0e3e7" fillOpacity=".3" stroke="#e8ffff" />
      <circle cx="130" cy="129" r="4" fill="#f0ffff" />
    </motion.g>
    <circle cx="225" cy="170" r="3" fill="#c7eff5" /><path d="M32 55v12m-6-6h12" stroke="#b8e5e8" strokeOpacity=".65" />
  </svg>
  return <svg viewBox="0 0 260 260" fill="none" aria-hidden="true">
    <defs><radialGradient id="portal-lens" cx=".35" cy=".28" r=".75"><stop stopColor="#fff1e2" /><stop offset=".25" stopColor="#c6bdd6" /><stop offset=".6" stopColor="#555d7e" /><stop offset="1" stopColor="#15191e" /></radialGradient><linearGradient id="portal-orbit" x1="20" y1="55" x2="230" y2="210" gradientUnits="userSpaceOnUse"><stop stopColor="#f5dcc6" /><stop offset=".48" stopColor="#b6bbdc" /><stop offset="1" stopColor="#797797" /></linearGradient></defs>
    <motion.g className="portal-lens-rings" style={{ rotate: orbit, transformOrigin: '130px 130px' }}>
      <ellipse cx="130" cy="130" rx="114" ry="48" transform="rotate(-35 130 130)" stroke="url(#portal-orbit)" strokeWidth="1.5" />
      <ellipse cx="130" cy="130" rx="104" ry="51" transform="rotate(35 130 130)" stroke="url(#portal-orbit)" strokeOpacity=".5" />
      <circle cx="206" cy="65" r="5" fill="#e7d6db" />
    </motion.g>
    <motion.ellipse cx="130" cy="130" rx="100" ry="45" style={{ rotate: counterOrbit, transformOrigin: '130px 130px' }} stroke="url(#portal-orbit)" strokeOpacity=".65" />
    <circle cx="130" cy="130" r="55" fill="url(#portal-lens)" />
    <motion.path d="M37 176c23 2 64-12 103-39s66-57 70-78" style={{ rotate: orbit, transformOrigin: '130px 130px' }} stroke="#ead8db" strokeWidth="2" />
    <circle cx="51" cy="69" r="2" fill="#eee5f8" /><path d="M221 194v14m-7-7h14" stroke="#c6c8e4" strokeOpacity=".6" />
  </svg>
}

function PaperLayer({ offset, phase }: { offset: number; phase: MotionValue<number> }) {
  const y = useTransform(phase, value => offset + Math.sin(value + offset / 16) * (offset === 0 ? 15 : 9))
  const rotate = useTransform(phase, value => Math.sin(value + offset / 18) * 8)
  const scaleY = useTransform(phase, value => .88 + Math.cos(value + offset / 18) * .12)
  return <motion.g className="portal-paper-layer" style={{ y, rotate, scaleY, transformOrigin: '130px 130px' }}>
    <path d="M47 99 137 46 216 114 122 174Z" fill="url(#portal-paper)" stroke="url(#portal-paper-edge)" strokeWidth="1" />
    <path d="m47 99 75 75 94-60v8l-94 61-75-75Z" fill="#bcab96" fillOpacity=".12" stroke="#c7b295" strokeOpacity=".45" />
    {offset === 0 && <><path d="m89 99 44-26m-32 38 45-27m-32 38 44-27m-31 38 30-18" stroke="#fff1d9" strokeOpacity=".65" strokeWidth="2" /><path d="m137 46 7 35 24-9" fill="#fff1d9" fillOpacity=".15" stroke="#dcc7aa" strokeOpacity=".7" /></>}
  </motion.g>
}

/** 投影八个顶点，呈现真实的纵轴旋转，而非把平面图标转一圈。 */
function crystalPath(angle: number, size: number) {
  const vertices = Array.from({ length: 8 }, (_, index) => {
    const x = index & 1 ? size : -size
    const y = index & 2 ? size : -size
    const z = index & 4 ? size : -size
    const rx = x * Math.cos(angle + .6) + z * Math.sin(angle + .6)
    const rz = z * Math.cos(angle + .6) - x * Math.sin(angle + .6)
    const ry = y * Math.cos(.42) - rz * Math.sin(.42)
    const depth = y * Math.sin(.42) + rz * Math.cos(.42)
    const perspective = 500 / (500 + depth)
    return `${(130 + rx * perspective).toFixed(2)},${(130 + ry * perspective).toFixed(2)}`
  })
  const faces = [[0, 1, 3, 2], [4, 5, 7, 6], [0, 4], [1, 5], [2, 6], [3, 7]]
  return faces.map(face => `M${face.map(index => vertices[index]).join('L')}${face.length === 4 ? 'Z' : ''}`).join(' ')
}
