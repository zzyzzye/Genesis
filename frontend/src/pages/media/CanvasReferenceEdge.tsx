import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react'
import { AnimatePresence, motion } from 'motion/react'
import { canvasReferenceFlow, useLiveReducedMotion } from '../../lib/motion'

export function CanvasReferenceEdge(props: EdgeProps) {
  // 端点落在圆点中心，不落在扩大后的透明命中区外沿。
  const [path] = getBezierPath({ ...props, sourceX: props.sourceX - 16, targetX: props.targetX + 16 })
  const reducedMotion = useLiveReducedMotion()
  return <>
    <BaseEdge id={props.id} path={path} style={props.style} markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={props.interactionWidth} />
    {/* 光段只表达引用方向，不表示任务正在执行；交互仍由原生连线承担。 */}
    {/* 独立 Presence 避免路由首屏禁用入场时同时冻结持续的路径动效。 */}
    <AnimatePresence>
      {!reducedMotion && <motion.path key="flow" className="media-reference-flow" d={path} fill="none" aria-hidden="true" pointerEvents="none"
        variants={canvasReferenceFlow} initial="initial" animate="flow" />}
    </AnimatePresence>
  </>
}
