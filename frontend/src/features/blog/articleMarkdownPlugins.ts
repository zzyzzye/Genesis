import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkSupersub from 'remark-supersub'
import remarkFlexibleMarkers from 'remark-flexible-markers'
import type { PluggableList } from 'unified'

// 正文与目录复用同一语法，避免公式中的等号被识别为标题。
export const articleRemarkPlugins: PluggableList = [[remarkGfm, { singleTilde: false }], remarkMath, remarkSupersub, remarkFlexibleMarkers]
