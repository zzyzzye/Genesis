import '@xyflow/react/dist/style.css'
import './CanvasNodes.css'
import { FpsStatusSlot } from '../../features/performance/FpsMonitor'

import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  applyEdgeChanges,
  useViewport,
  type Connection,
  type Edge as FlowEdge,
  type EdgeChange,
  type Node as FlowNode,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { canvasEditorTransition, useLiveReducedMotion } from '../../lib/motion'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ClipboardPaste, Copy, Film, FolderOpen, GripVertical, Hand, ImagePlus, LoaderCircle, Map as MapIcon, MousePointer2, Music2, Play, Shapes, SlidersHorizontal, StickyNote, Type, Upload, Workflow, X } from 'lucide-react'
import { api, defaultGenerationSettings, type Asset, type Document, type Edge, type Node, type Project, type VideoFrame, upload } from './api'
import { connectReference, displayPrompt, imageMentionPattern, imageMentionToken, imageReferenceNumbers, imageReferences, incomingReferences, syncReferenceModes } from './canvasReferences'
import { AssetPreview } from './AssetPreview'
import { AssetLibrary } from './AssetLibrary'
import { CanvasReferenceEdge } from './CanvasReferenceEdge'
import { ReferencePrompt, type ReferencePromptHandle } from './ReferencePrompt'
import { ImageGeneration, VideoGeneration, type GenerationTask } from './VideoGeneration'
import { useGenerationResults } from './useGenerationResults'
import { ImageParameters } from './ImageParameters'
import { VideoParameters } from './VideoParameters'
import { imageSettingsSummary } from './imageSettings'
import { ProjectDialog } from './MediaHome'
import type { MediaAssistantNode, MediaCanvasActions, MediaCanvasPlan } from './MediaAssistant'
import { useCanvas } from './useCanvas'
import { arrangeCanvas } from './canvasLayout'
import { applyCanvasNodeChanges, audioAssetNodeSize, defaultNodeName, generationNodeSize, groupSelection, isGenerationNode, nodeTypeLabel, removeSelection, resizedNodeDimensions, ungroupSelection } from './canvasOperations'

type CanvasNodeData = {
  projectId: string
  onSave: () => Promise<void>
  onGenerationTask: (task: GenerationTask, createResults?: boolean) => void
  source: Node
  asset?: Asset
  assetsLoading: boolean
  references: ReturnType<typeof incomingReferences>
  referenceCandidates: Node[]
  onReferenceChange: (id: string, sourceId: string, connected: boolean) => void
  frame: VideoFrame
  zoom: number
  onTextChange: (id: string, text: string) => void
  onPatch: (id: string, patch: Partial<Node>, record?: boolean) => void
  onOpenAssets: () => void
  onOpenNodeAssets: (id: string, kind: 'image' | 'audio' | 'video') => void
  onUploadNodeAsset: (id: string, kind: Asset['kind'], file: File) => Promise<void>
  onConvertToVideo: (id: string) => void
  onInteractionStart: () => void
  onInteractionEnd: () => void
  editorOpen: boolean
  onCloseEditor: () => void
}

type CanvasFlowNode = FlowNode<CanvasNodeData, Node['type']>

function CanvasAssetPicker({ projectId, target, onClose, onSelect }: { projectId: string; target: { id: string; kind: Asset['kind']; allowImageForVideo: boolean }; onClose: () => void; onSelect: (asset: Asset) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="media-canvas-asset-picker" aria-label="选择节点素材" onCancel={onClose} onClose={onClose}>
    <header><h2>选择节点素材</h2><button type="button" aria-label="关闭素材选择" onClick={onClose}><X size={18} /></button></header>
    <AssetLibrary projectId={projectId} presentation="page" selectionOnly targetKind={target.kind} allowImageForVideo={target.allowImageForVideo} initialKind={target.allowImageForVideo ? '' : target.kind} onClose={onClose} onAdd={onSelect} />
  </dialog>
}

function CanvasGenerationEditor({ id, data, dragging }: { id: string; data: CanvasNodeData; dragging: boolean }) {
  const reducedMotion = useLiveReducedMotion()
  const isPresent = useIsPresent()
  return <motion.div className="media-node-editor nodrag nowheel nopan" data-node-id={id} role="region" inert={!isPresent || dragging} aria-hidden={!isPresent || dragging} aria-label={`${data.source.name || nodeTypeLabel(data.source.type)}编辑面板`}
    variants={canvasEditorTransition} initial={reducedMotion ? false : 'initial'} animate="enter" exit={reducedMotion ? { opacity: 0, transition: { duration: 0 } } : 'exit'}
    style={{ visibility: dragging ? 'hidden' : undefined, pointerEvents: dragging ? 'none' : undefined }}>
    <button className="media-node-editor-close" type="button" aria-label="关闭节点编辑" onClick={data.onCloseEditor}><X size={15} /></button>
    <GenerationNodeComposer id={id} data={data} />
  </motion.div>
}

function CanvasResizeCorner({ id, data, minWidth, minHeight, label }: { id: string; data: CanvasNodeData; minWidth: number; minHeight: number; label: string }) {
  const resize = useRef<{ x: number; y: number; width: number; height: number; zoom: number } | null>(null)
  return <div
    className="media-canvas-resize nodrag"
    role="group"
    tabIndex={0}
    aria-roledescription="尺寸控制"
    aria-label={`${label}，${Math.round(data.source.width)} × ${Math.round(data.source.height)}，使用方向键调整，Shift 加速`}
    title="拖动或用方向键调整节点大小，Shift 加速"
    onKeyDown={(event) => {
      const delta = event.shiftKey ? 50 : 10
      const changes: Record<string, [number, number]> = { ArrowRight: [delta, 0], ArrowLeft: [-delta, 0], ArrowDown: [0, delta], ArrowUp: [0, -delta] }
      const change = changes[event.key]
      if (!change) return
      event.preventDefault()
      event.stopPropagation()
      data.onPatch(id, resizedNodeDimensions(data.source.width, data.source.height, change[0], change[1], 1, minWidth, minHeight))
    }}
    onPointerDown={(event) => {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.focus({ preventScroll: true })
      resize.current = { x: event.clientX, y: event.clientY, width: data.source.width, height: data.source.height, zoom: data.zoom }
      event.currentTarget.setPointerCapture(event.pointerId)
      data.onInteractionStart()
    }}
    onPointerMove={(event) => {
      if (!resize.current) return
      const start = resize.current
      data.onPatch(id, resizedNodeDimensions(start.width, start.height, event.clientX - start.x, event.clientY - start.y, start.zoom, minWidth, minHeight), false)
    }}
    onPointerUp={(event) => {
      if (!resize.current) return
      resize.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      data.onInteractionEnd()
    }}
    onPointerCancel={() => { resize.current = null; data.onInteractionEnd() }}
  />
}

function CanvasNodeName({ id, data }: { id: string; data: CanvasNodeData }) {
  const [draft, setDraft] = useState<string | null>(null)
  const cancelled = useRef(false)
  const name = data.source.name || nodeTypeLabel(data.source.type)
  const originalName = useRef(name)
  return <input
    className="media-node-name nodrag"
    aria-label={`${nodeTypeLabel(data.source.type)}名称`}
    title="点击改名；Enter 保存，Escape 取消"
    value={draft ?? name}
    maxLength={120}
    onFocus={() => { cancelled.current = false; originalName.current = name; setDraft(name) }}
    onChange={(event) => setDraft(event.target.value)}
    onBlur={() => {
      const next = draft?.trim() || originalName.current
      if (!cancelled.current && next !== originalName.current && next !== name) data.onPatch(id, { name: next })
      setDraft(null)
    }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || !['Enter', 'Escape'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      cancelled.current = event.key === 'Escape'
      event.currentTarget.blur()
    }}
  />
}

function GenerationNodeView({ id, data, selected, dragging }: NodeProps<CanvasFlowNode>) {
  const node = data.source
  const isImage = node.type === 'image_generation'
  const isAudio = node.type === 'audio_generation'
  const label = nodeTypeLabel(node.type)
  const Icon = isImage ? ImagePlus : isAudio ? Music2 : Play
  const preview = data.asset && (isImage ? data.asset.kind === 'image' : isAudio ? data.asset.kind === 'audio' : data.asset.kind !== 'audio') ? data.asset : null
  return <article className={`media-video-card ${selected ? 'is-selected' : ''}`} aria-label={node.name || label}>
    <Handle type="target" position={Position.Left} aria-label={`${label}输入连接点`} />
    <Handle type="source" position={Position.Right} aria-label={`${label}输出连接点`} />
    <CanvasResizeCorner id={id} data={data} minWidth={360} minHeight={240} label={`调整${label}大小`} />
    <div className="media-node-grip media-node-drag-handle media-video-grip" title="拖动移动节点"><Icon size={17} aria-hidden="true" /><CanvasNodeName id={id} data={data} /><GripVertical className="media-node-drag-mark" size={16} aria-hidden="true" /></div>
    <div className="media-video-preview-shell media-node-drag-handle">
      <div className="media-video-screen">
        {preview ? <div className="media-node-drag-surface nopan media-node-preview"><AssetPreview asset={preview} controls={selected || isAudio} /></div> : node.asset_id && data.assetsLoading ? <div role="status">正在加载预览素材…</div> : <div className="media-video-placeholder"><Icon size={64} aria-hidden="true" /><span>{displayPrompt(node.text.trim(), data.references) || (isImage ? '描述想要生成的图片，或添加参考素材' : isAudio ? '描述想要生成的声音，或添加参考音频' : '描述想要生成的视频，或添加参考素材')}</span></div>}
      </div>
    </div>
    <AnimatePresence>{data.editorOpen && <CanvasGenerationEditor key={id} id={id} data={data} dragging={dragging} />}</AnimatePresence>
  </article>
}

export function GenerationParameters({ summary, disabled, image = false, video = false, children }: { summary: ReactNode; disabled?: boolean; image?: boolean; video?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const nativePopover = typeof HTMLElement.prototype.togglePopover === 'function'
  const viewport = useViewport()
  const frame = useRef<number | null>(null)
  const position = useCallback(() => {
    const surface = panel.current
    const button = trigger.current
    if (!surface || !button) return
    if (button.closest('.media-node-editor[aria-hidden="true"]')) {
      surface.hidePopover?.()
      setOpen(false)
      return
    }
    const rect = button.getBoundingClientRect()
    const width = Math.min(image || video ? 340 : 300, window.innerWidth - 24)
    surface.style.width = `${width}px`
    surface.style.maxHeight = `${window.innerHeight - 24}px`
    surface.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`
    const height = surface.getBoundingClientRect().height
    surface.style.top = `${Math.max(12, Math.min(rect.top - height - 8, window.innerHeight - height - 12))}px`
  }, [image, video])
  useLayoutEffect(() => {
    if (!open) return
    // 等待 React Flow 提交视口变换，再读取节点按钮的实际屏幕位置。
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(position)
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }
  }, [open, position, viewport.x, viewport.y, viewport.zoom, children])
  useEffect(() => {
    const close = () => { panel.current?.hidePopover?.(); setOpen(false) }
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('resize', close)
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])
  return <>
    <button ref={trigger} className="media-video-spec" type="button" aria-label="生成参数" aria-expanded={open} disabled={disabled} onClick={() => {
      if (panel.current) {
        panel.current.togglePopover?.()
        position()
        setOpen(!open)
      }
    }} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open) return
      event.preventDefault(); event.stopPropagation()
      panel.current?.hidePopover?.(); setOpen(false)
    }}><SlidersHorizontal size={13} aria-hidden="true" />{summary}<ChevronDown size={13} aria-hidden="true" /></button>
    <div ref={panel} popover={nativePopover ? 'auto' : undefined} hidden={!nativePopover && !open} data-open={open} className={`media-generation-popover media-node-generation-settings nodrag nowheel media-wheel-isolated nopan ${image || video ? 'media-image-parameters' : ''} ${video ? 'media-video-parameters' : ''}`} aria-label="生成参数" onToggle={(event) => setOpen(event.currentTarget.matches(':popover-open'))} onKeyDown={(event) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation()
      panel.current?.hidePopover?.(); setOpen(false); trigger.current?.focus()
    }}>{children}</div>
  </>
}

function GenerationNodeComposer({ id, data }: { id: string; data: CanvasNodeData }) {
  const node = data.source
  const isImage = node.type === 'image_generation'
  const isAudio = node.type === 'audio_generation'
  const isVideo = node.type === 'video'
  const fileInput = useRef<HTMLInputElement>(null)
  const referencePrompt = useRef<ReferencePromptHandle>(null)
  const appendPromptToken = (token: string) => data.onTextChange(id, `${node.text}${node.text ? ' ' : ''}${token}`)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [durationError, setDurationError] = useState('')
  const settings = node.generation ?? defaultGenerationSettings()
  const patchSettings = (patch: Partial<typeof settings>) => data.onPatch(id, { generation: { ...settings, ...patch } })
  const imageRefs = imageReferences(data.references)
  const imageNumbers = imageReferenceNumbers(data.references)
  const missingMention = [...node.text.matchAll(imageMentionPattern)].some(match => !imageRefs.some(reference => reference.node.id === match[1]))
  const hasMaterial = data.references.some(item => item.asset || ['image', 'image_generation', 'video', 'video_asset', 'audio', 'audio_generation'].includes(item.node.type))
  const videoMode = hasMaterial ? settings.mode === 'first_last' ? 'first_last' : 'reference' : 'text'
  const modeControl = <select aria-label="参考模式" value={isVideo ? videoMode : settings.mode} onChange={(event) => patchSettings({ mode: event.target.value as typeof settings.mode })}>{(!isVideo || !hasMaterial) && <option value="text">{isAudio ? '文生音频' : '文生视频'}</option>}{(!isVideo || hasMaterial) && <option value="reference">{isAudio ? '音频参考' : '素材参考'}</option>}{isVideo && hasMaterial && <option value="first_last">首尾帧</option>}</select>
  const parameterControl = isImage ? <GenerationParameters image summary={imageSettingsSummary(settings)}><ImageParameters settings={settings} onChange={patchSettings} /></GenerationParameters> : isVideo ? <GenerationParameters video summary={`${settings.ratio} · ${settings.resolution === '2160P' ? '4K' : settings.resolution} · ${node.duration_seconds ?? 5}s`}><VideoParameters settings={settings} duration={node.duration_seconds ?? 5} onChange={patchSettings} onDurationChange={duration_seconds => data.onPatch(id, { duration_seconds }, false)} onInteractionStart={data.onInteractionStart} onInteractionEnd={data.onInteractionEnd} /></GenerationParameters> : <GenerationParameters summary={`${node.duration_seconds ?? 5}s · ${settings.count}个`}>
    <label>{isAudio ? '音频时长' : '镜头时长'}<span><input key={node.duration_seconds} type="number" aria-label={isAudio ? '音频时长' : '镜头时长'} aria-invalid={Boolean(durationError)} aria-describedby={durationError ? `duration-error-${id}` : undefined} min={1} max={600} step={1} defaultValue={node.duration_seconds ?? 5} onFocus={data.onInteractionStart} onBlur={(event) => {
      const seconds = Number(event.target.value)
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
        setDurationError('请输入 1–600 的整数秒，已保留原时长。')
        event.target.value = String(node.duration_seconds ?? 5)
      } else {
        setDurationError('')
        if (seconds !== node.duration_seconds) data.onPatch(id, { duration_seconds: seconds }, false)
      }
      data.onInteractionEnd()
    }} /> 秒</span></label>
    {!isVideo && <label>数量<select aria-label="生成数量" value={settings.count} onChange={(event) => patchSettings({ count: Number(event.target.value) as typeof settings.count })}>{[1, 2, 4].map((count) => <option key={count} value={count}>{count} {isImage ? '张' : '个'}</option>)}</select></label>}
    {durationError && <p className="media-node-field-error" id={`duration-error-${id}`} aria-live="polite">{durationError}</p>}
  </GenerationParameters>
  return <section className="media-video-composer nodrag nowheel nopan" aria-label={isImage ? '生图草稿' : isAudio ? '生音频草稿' : '镜头草稿'} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !(cameraOpen || referencesOpen)) return
    event.stopPropagation()
    setCameraOpen(false); setReferencesOpen(false)
    event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus()
  }}>
      <div className="media-video-composer-top">
        <button type="button" onClick={() => fileInput.current?.click()}><Upload size={14} />上传</button>
        <button type="button" onClick={() => data.onOpenNodeAssets(id, isImage ? 'image' : isAudio ? 'audio' : 'video')}>作品素材</button>
        <button type="button" aria-expanded={referencesOpen} onClick={() => { setReferencesOpen(!referencesOpen); setCameraOpen(false) }}>画布参考{data.references.length ? ` · ${data.references.length}` : ''}</button>
        {isVideo && <button type="button" aria-expanded={cameraOpen} onClick={() => { setCameraOpen(!cameraOpen); setReferencesOpen(false) }}>运镜</button>}
      </div>
      {cameraOpen && <div className="media-node-camera-options" aria-label="选择运镜">{['固定镜头', '缓慢推近', '拉远镜头', '跟随拍摄', '镜头上摇', '镜头下摇', '环绕拍摄', '手持拍摄'].map((camera) => <button key={camera} type="button" onClick={() => { appendPromptToken(`运镜：${camera}。`); setCameraOpen(false) }}>{camera}</button>)}</div>}
      {data.references.length > 0 && <div className="media-node-references" aria-label="连入参考">{data.references.map(({ node: source, asset }, index) => {
        const name = source.name || asset?.name || source.text.slice(0, 40) || '空节点'
        return <div key={source.id} className="media-reference-item" role="group" aria-label={`参考 ${index + 1}：${name}`}>
          <button type="button" className="media-reference-thumbnail" title={(isVideo || isImage) && imageRefs.some(item => item.node.id === source.id) ? `在提示词中引用：${name}` : name} aria-label={`引用参考：${source.name || name}`} disabled={!(isVideo || isImage) || !imageRefs.some(item => item.node.id === source.id)} onMouseDown={event => event.preventDefault()} onClick={() => referencePrompt.current?.insertImage(source.id)}>
            {asset && asset.kind !== 'audio' ? <AssetPreview key={asset.id} asset={asset} thumbnail passive /> : asset?.kind === 'audio' || source.type === 'audio' || source.type === 'audio_generation' ? <Music2 size={20} strokeWidth={1.6} aria-label="音频参考" /> : source.type === 'image' || source.type === 'image_generation' ? <ImagePlus size={20} strokeWidth={1.6} aria-label="待就绪图片参考" /> : !source.asset_id && source.text ? <Type size={20} strokeWidth={1.6} aria-label="文字参考" /> : source.type === 'video' || source.type === 'video_asset' ? <Film size={20} strokeWidth={1.6} aria-hidden="true" /> : <ImagePlus size={20} strokeWidth={1.6} aria-hidden="true" />}
            <span className="media-reference-index" aria-hidden="true">{(isVideo || isImage) && imageNumbers.has(source.id) ? `图${imageNumbers.get(source.id)}` : index + 1}</span>
          </button>
        </div>
      })}</div>}
      {referencesOpen && <div className="media-node-reference-panel">
        <label className="media-node-reference-picker"><span>添加参考</span><select aria-label="添加参考节点" value="" onChange={(event) => { if (event.target.value) data.onReferenceChange(id, event.target.value, true) }}><option value="">选择画布中的节点…</option>{data.referenceCandidates.map((source) => <option key={source.id} value={source.id}>{source.name || source.text.slice(0, 30) || '未命名节点'}</option>)}</select></label>
        {data.references.length ? <div className="media-reference-details" aria-label="参考管理">{data.references.map(({ node: source, asset }, index) => <div key={source.id}>
          <span title={source.name || asset?.name || source.text}>{index + 1} · {source.name || asset?.name || source.text.slice(0, 40) || '空节点'}</span>
          <small>{source.asset_id && !asset ? (data.assetsLoading ? '加载中' : '素材不可用') : !asset && (source.type === 'image' || source.type === 'image_generation') ? '图片未就绪' : !asset && !source.text ? '请先补充内容' : '已连接'}</small>
          {source.text && <button type="button" onClick={() => appendPromptToken(source.text)}>引用文字</button>}
          <button type="button" aria-label={`断开参考：${source.name || asset?.name || '节点'}`} onClick={() => data.onReferenceChange(id, source.id, false)}>断开</button>
        </div>)}</div> : <p>选择上游节点，或从它的连接点拖线到当前节点。</p>}
      </div>}
      <input ref={fileInput} className="media-video-file-input" type="file" accept={isImage ? 'image/jpeg,image/png,image/webp,image/gif,image/avif' : isAudio ? 'audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/webm,audio/aac' : 'image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/webm,video/quicktime,video/x-matroska'} aria-label={`导入${nodeTypeLabel(node.type)}${isImage || isVideo ? '参考' : '预览'}素材`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void data.onUploadNodeAsset(id, isAudio ? 'audio' : isVideo && file.type.startsWith('video/') ? 'video' : 'image', file); event.target.value = '' }} />
      {(isVideo || isImage) && (imageRefs.length > 0 || node.text.includes('](ref:')) ? <ReferencePrompt ref={referencePrompt} value={node.text} references={imageRefs} label={isImage ? "图片提示词" : "镜头描述"} onFocus={data.onInteractionStart} onBlur={data.onInteractionEnd} onChange={text => data.onTextChange(id, text)} /> : <textarea className="resize-none" aria-label={isImage ? '图片提示词' : isAudio ? '音频提示词' : '镜头描述'} value={node.text} placeholder={isImage ? '描述想要生成的图片内容，可引用画布素材' : isAudio ? '描述声音、音乐风格或环境氛围，可引用画布素材' : '描述画面、人物动作与声音，可引用连入节点的文字'} maxLength={20000} onFocus={data.onInteractionStart} onBlur={data.onInteractionEnd} onChange={(event) => data.onTextChange(id, event.target.value)} />}
      {isVideo ? <VideoGeneration projectId={data.projectId} node={{ ...node, generation: { ...settings, mode: videoMode } }} controls={<>{modeControl}{parameterControl}</>} referenceCount={data.references.filter((item) => item.asset).length} referencesPending={data.references.some(item => !item.asset && (Boolean(item.node.asset_id) || ["image", "image_generation", "video", "video_asset", "audio", "audio_generation"].includes(item.node.type)))} referenceError={missingMention ? "提示词中的图片引用已断开，请重新连线或删除该引用。" : undefined} onPatch={(patch) => data.onPatch(id, patch)} onSave={data.onSave} onTask={data.onGenerationTask} /> : isImage ? <ImageGeneration projectId={data.projectId} node={node} controls={parameterControl} referenceCount={imageRefs.length} referencesPending={imageRefs.some(({ asset }) => !asset)} referenceError={missingMention ? "提示词中的图片引用已断开，请重新连线或删除该引用。" : undefined} onPatch={(patch) => data.onPatch(id, patch)} onSave={data.onSave} onTask={data.onGenerationTask} /> : <div className="media-video-composer-footer">{modeControl}{parameterControl}</div>}
    </section>
}

function MediaAssetNodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const node = data.source
  const kind = node.type === 'image' ? 'image' : node.type === 'video_asset' ? 'video' : 'audio'
  const isImage = kind === 'image'
  const kindLabel = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
  const asset = data.asset?.kind === kind ? data.asset : undefined
  const fileInput = useRef<HTMLInputElement>(null)
  const label = nodeTypeLabel(node.type)
  const Icon = isImage ? ImagePlus : kind === 'video' ? Film : Music2
  const result = node.video_result ?? node.image_result
  const generating = Boolean(result && ['requesting', 'submitting', 'queued', 'processing', 'downloading', 'completed'].includes(result.status))
  const resultLabel = result && ['requesting', 'submitting'].includes(result.status) ? `正在提交${kindLabel}…` : result?.status === 'downloading' ? `正在保存${kindLabel}…` : result?.status === 'completed' ? `正在加载${kindLabel}…` : generating ? `正在生成${kindLabel}…` : result?.status === 'download_failed' ? `${kindLabel}保存失败` : result?.status === 'failed' ? `${kindLabel}生成失败` : `${kindLabel}任务待核实`
  return <article className={`media-node media-node--media media-node--material ${kind === 'audio' ? 'is-audio-material' : ''} ${selected ? 'is-selected' : ''}`} aria-label={node.name || label}>
    <CanvasResizeCorner id={id} data={data} minWidth={kind === 'audio' ? 300 : 160} minHeight={80} label={`调整${label}大小`} />
    <Handle type="target" position={Position.Left} aria-label="输入连接点" />
    <div className="media-node-grip media-node-drag-handle" title="拖动移动节点"><Icon size={16} aria-hidden="true" /><CanvasNodeName id={id} data={data} /><GripVertical className="media-node-drag-mark" size={16} aria-hidden="true" /></div>
    <input ref={fileInput} className="media-video-file-input" type="file" accept={isImage ? 'image/jpeg,image/png,image/webp,image/gif,image/avif' : kind === 'video' ? 'video/mp4,video/webm,video/quicktime,video/x-matroska' : 'audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/webm,audio/aac'} aria-label={`导入${label}素材`} onChange={(event) => { const file = event.target.files?.[0]; if (file) void data.onUploadNodeAsset(id, kind, file); event.target.value = '' }} />
    {node.asset_id && data.assetsLoading ? <div className="media-node-media-empty" role="status">正在加载素材…</div> : asset
      ? <div className="media-node-drag-surface nopan media-node-preview"><AssetPreview asset={asset} controls onImageDimensions={(width, height) => {
        // 初次放入的图片按原图比例定高，不覆盖用户手动调整的尺寸。
        if (width > 0 && height > 0 && node.width === 360 && node.height === 280) data.onPatch(id, { height: Math.max(80, Math.min(4000, node.width * height / width)) }, false)
      }} /></div>
      : result ? <div className="media-node-drag-surface nopan media-node-media-empty media-image-result" role="status" aria-busy={generating}>
        {generating ? <LoaderCircle size={28} className="is-spinning" aria-hidden="true" /> : <Icon size={28} aria-hidden="true" />}
        <strong>{resultLabel}</strong>{result.error && <span>{result.error}</span>}
      </div> : <div className="media-node-drag-surface nopan media-node-media-empty"><Icon size={24} aria-hidden="true" /><div className="nodrag"><button type="button" onClick={() => fileInput.current?.click()}>导入{kindLabel}</button><button type="button" onClick={() => data.onOpenNodeAssets(id, kind)}>选择作品素材</button></div></div>}
    {asset && <div className="media-node-media-actions nodrag nopan"><button type="button" aria-label="导入替换" title="导入替换" onClick={() => fileInput.current?.click()}><Upload size={15} aria-hidden="true" /></button><button type="button" aria-label="选择作品素材" title="选择作品素材" onClick={() => data.onOpenNodeAssets(id, kind)}><FolderOpen size={15} aria-hidden="true" /></button><button type="button" aria-label="清空节点素材" title="清空节点素材" onClick={() => data.onPatch(id, { asset_id: null, image_result:null, video_result:null })}><X size={15} aria-hidden="true" /></button></div>}
    <Handle type="source" position={Position.Right} aria-label="输出连接点" />
  </article>
}

function CanvasNodeView({ id, type, data, selected }: NodeProps<CanvasFlowNode>) {
  const [editingEmptyShape, setEditingEmptyShape] = useState(false)
  const [textFocused, setTextFocused] = useState(false)
  const isNote = type === 'note'
  const isText = type === 'text'
  const isShape = type === 'shape'
  const isGroup = type === 'group'
  const label = data.source.name || nodeTypeLabel(data.source.type)
  return <article
    aria-label={label}
    className={`media-node ${isNote ? 'is-note' : ''} ${isText ? 'is-text' : ''} ${isShape ? 'is-shape' : ''} ${isGroup ? 'is-group' : ''} ${selected ? 'is-selected' : ''}`}
  >
    <CanvasResizeCorner id={id} data={data} minWidth={100} minHeight={80} label="调整节点大小" />
    {!isGroup && <Handle type="target" position={Position.Left} aria-label="输入连接点" />}
    <div className="media-node-grip media-node-drag-handle" title="拖动移动节点"><CanvasNodeName id={id} data={data} />{isGroup && <span className="media-node-member-count">{data.source.member_ids?.length ?? 0} 个节点</span>}<GripVertical className="media-node-drag-mark" size={16} aria-hidden="true" /></div>
    {isShape && !data.source.text.trim() && !editingEmptyShape
      ? <div className="media-shape-convert nodrag nopan"><span>这是旧的形状节点</span><button onClick={() => data.onConvertToVideo(id)}>改为生视频节点</button><button className="media-shape-edit" onClick={() => setEditingEmptyShape(true)}>保留形状并编辑文字</button></div>
      : isNote || isText || isShape
      ? <textarea
          className={`nodrag nopan resize-none${textFocused ? ' nowheel' : ''}`}
          aria-label={isNote ? '便签内容' : isText ? '文字内容' : '形状文字'}
          value={data.source.text}
          placeholder={isNote ? '写下镜头、情绪或灵感…' : isText ? '点击这里输入文字…' : '输入形状标签…'}
          maxLength={20000}
          onFocus={() => { setTextFocused(true); data.onInteractionStart() }}
          onBlur={() => { setTextFocused(false); data.onInteractionEnd() }}
          onChange={(event) => data.onTextChange(id, event.target.value)}
        />
      : !isGroup && data.asset && <div className="media-node-drag-surface nopan media-node-preview"><AssetPreview asset={data.asset} controls /></div>}
    {!isGroup && <Handle type="source" position={Position.Right} aria-label="输出连接点" />}
  </article>
}

const nodeTypes = { asset: CanvasNodeView, note: CanvasNodeView, text: CanvasNodeView, shape: CanvasNodeView, group: CanvasNodeView, video: GenerationNodeView, image_generation: GenerationNodeView, audio_generation: GenerationNodeView, video_asset: MediaAssetNodeView, image: MediaAssetNodeView, audio: MediaAssetNodeView }
const edgeTypes = { reference: CanvasReferenceEdge }
export function ProjectCanvas({ projectId, userId, onAgentNodeChange, onAgentCanvasApplyChange, onAgentActionsChange }: { projectId: string; userId: string; onAgentNodeChange?: (node: MediaAssistantNode | null) => void; onAgentCanvasApplyChange?: (apply: ((plan: MediaCanvasPlan) => void) | null) => void; onAgentActionsChange?: (actions: MediaCanvasActions | null) => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const canvas = useCanvas(projectId, userId)
  const [project, setProject] = useState<Project | null>(null)
  const [assets, setAssets] = useState<Record<string, Asset>>({})
  const [error, setError] = useState('')
  const onGenerationTask = useGenerationResults(projectId, canvas, setAssets)
  const { save: saveCanvas, current: canvasDocument, syncNodeNames } = canvas
  useEffect(() => {
    if (!canvas.ready) { onAgentActionsChange?.(null); return }
    onAgentActionsChange?.({save:saveCanvas,getDocument:() => canvasDocument.current,syncNodeNames:async () => {
      try {
        await syncNodeNames()
        setError(current => current.startsWith('节点已改名，但画布同步失败') ? '' : current)
      } catch {
        setError('节点已改名，但画布同步失败；已保留本地编辑，正在重新读取。')
        throw new Error('节点改名同步失败')
      }
    },attachImageTask:async resource => {
      if (resource.scope_id !== projectId || !canvasDocument.current.nodes.some(node=>node.id === resource.parent_id && node.type === 'image_generation')) return
      try {
        const task = await api<GenerationTask>(`/projects/${projectId}/image-generations/${resource.id}`)
        if (task.node_id !== resource.parent_id) throw new Error('生成任务与画布节点不匹配')
        onGenerationTask(task)
        setError(current=>current.startsWith('图片任务已提交，但结果同步失败') ? '' : current)
      } catch {
        setError('图片任务已提交，但结果同步失败，正在重新读取任务；不会重复生成。')
        throw new Error('图片任务同步失败')
      }
    }})
    return () => onAgentActionsChange?.(null)
  }, [canvas.ready, canvasDocument, onAgentActionsChange, onGenerationTask, projectId, saveCanvas, syncNodeNames])
  const [assetsLoading, setAssetsLoading] = useState(true)
  const [renameOpen, setRenameOpen] = useState(false)
  const [assetTarget, setAssetTarget] = useState<{ id: string; kind: Asset['kind']; allowImageForVideo: boolean } | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [draggingNode, setDraggingNode] = useState(false)
  // 复用原生手势起止，平移跨过节点时不移交滚轮，也不启动新的节点拖拽。
  const [wheelPanning, setWheelPanning] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [clipboardProjectId, setClipboardProjectId] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const [nodeMenu, setNodeMenu] = useState(false)
  const [paletteAnchor, setPaletteAnchor] = useState<{ x: number; y: number; flowX: number; flowY: number; connection?: { id: string; side: 'left' | 'right' } } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [showMiniMap, setShowMiniMap] = useState(false)
  const [draggingFile, setDraggingFile] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [previewRetry, setPreviewRetry] = useState<{ id: string; file: File; kind: Asset['kind'] } | null>(null)
  const uploadActive = useRef(false)
  const [tool, setTool] = useState<'select' | 'pan'>('select')
  const [reloadOpen, setReloadOpen] = useState(false)
  const reloadDialog = useRef<HTMLDialogElement>(null)
  const [flow, setFlow] = useState<ReactFlowInstance<CanvasFlowNode> | null>(null)
  const canvasElement = useRef<HTMLDivElement>(null)
  const nodeMenuElement = useRef<HTMLDivElement>(null)
  const nodeMenuTrigger = useRef<HTMLButtonElement>(null)
  const interactionActive = useRef(false)
  const importedFromLibrary = useRef<string | null>(null)
  const clipboard = useRef<{ projectId: string; nodes: Node[]; edges: Edge[] } | null>(null)
  const pasteCount = useRef(0)
  const agentPlanApplyRef = useRef<(plan: MediaCanvasPlan) => void>(() => undefined)

  useEffect(() => {
    if (reloadOpen) reloadDialog.current?.showModal()
    else if (reloadDialog.current?.open) reloadDialog.current.close()
  }, [reloadOpen])

  useEffect(() => {
    if (!nodeMenu) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as globalThis.Node
      if (nodeMenuElement.current?.contains(target) || nodeMenuTrigger.current?.contains(target)) return
      setNodeMenu(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setNodeMenu(false)
      nodeMenuTrigger.current?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', dismissOnEscape)
    }
  }, [nodeMenu])

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest('.media-node-context-menu')) setContextMenu(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [contextMenu])

  const beginInteraction = useCallback(() => {
    if (interactionActive.current) return
    interactionActive.current = true
    canvas.checkpoint()
  }, [canvas])

  const endInteraction = useCallback(() => {
    interactionActive.current = false
  }, [])

  const updateText = useCallback((id: string, text: string) => {
    const current = canvas.current.current
    canvas.apply({
      ...current,
      nodes: current.nodes.map((node) => node.id === id ? { ...node, text } : node),
    }, false)
  }, [canvas])

  const patchNode = useCallback((id: string, patch: Partial<Node>, record = true) => {
    const current = canvas.current.current
    const target = current.nodes.find(node => node.id === id)
    const renameAsset = patch.name !== undefined && target?.asset_id && ['image', 'video_asset', 'audio', 'asset'].includes(target.type)
    canvas.apply({ ...current, nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : renameAsset && node.asset_id === target.asset_id && ['image', 'video_asset', 'audio', 'asset'].includes(node.type) ? { ...node, name:patch.name } : node) }, record)
  }, [canvas])

  const changeReference = useCallback((id: string, sourceId: string, connected: boolean) => {
    const current = canvas.current.current
    if (id === sourceId || !current.nodes.some((node) => node.id === sourceId && node.type !== 'group')) return
    const existing = current.edges.some((edge) => edge.source === sourceId && edge.target === id)
    if (existing === connected) return
    const edges = connected ? [...current.edges, { id: crypto.randomUUID(), source: sourceId, target: id }] : current.edges.filter((edge) => edge.source !== sourceId || edge.target !== id)
    canvas.apply(connected ? connectReference(current, sourceId, id) : syncReferenceModes({ ...current, edges }))
  }, [canvas])

  const openAssets = useCallback(() => {
    void canvas.save().then(() => navigate(`/media/projects/${projectId}/assets`)).catch((reason: Error) => setError(reason.message))
  }, [canvas, navigate, projectId])

  const openNodeAssets = useCallback((id: string, kind: 'image' | 'audio' | 'video') => {
    void canvas.save().then(() => setAssetTarget({ id, kind, allowImageForVideo: canvas.current.current.nodes.some((node) => node.id === id && node.type === 'video') })).catch((reason: Error) => setError(reason.message))
  }, [canvas])

  const assignNodeAsset = useCallback((id: string, asset: Asset) => {
    const current = canvas.current.current
    const target = current.nodes.find((node) => node.id === id)
    if (!target) throw new Error('目标节点已移除，请重新选择。')
    const asReference = target.type === 'image_generation' && asset.kind === 'image' || target.type === 'video' && ['image', 'video'].includes(asset.kind)
    if (!asReference) { patchNode(id, { asset_id:asset.id, image_result:null, video_result:null }); return }
    const alreadyConnected = current.edges.some((edge) => edge.target === id && current.nodes.some((source) => source.id === edge.source && source.asset_id === asset.id))
    if (alreadyConnected) return
    if (current.nodes.length >= 1000 || current.edges.length >= 2000) throw new Error('画布节点或连线已达上限，请整理后重试。')
    const sourceId = crypto.randomUUID()
    const references = current.edges.filter((edge) => edge.target === id).length
    // 上传和素材选择都建立可见参考连线，结果预览继续独立保留。
    const reference: Node = {id:sourceId,type:asset.kind === 'video' ? 'video_asset' : 'image',name:asset.name.slice(0,120),asset_id:asset.id,text:'',x:Math.max(-1000000,target.x-480),y:Math.min(1000000,target.y+references*312),width:360,height:280}
    const document = connectReference({ ...current, nodes:[...current.nodes, reference] }, sourceId, id)
    canvas.apply(target.type === 'image_generation' ? { ...document, nodes:document.nodes.map(node => node.id === id ? { ...node, generation:{ ...(node.generation ?? defaultGenerationSettings()), mode:'reference' } } : node) } : document)
  }, [canvas, patchNode])

  const uploadNodeAsset = useCallback(async (id: string, kind: Asset['kind'], file: File) => {
    const label = kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'
    if (uploadActive.current) return
    if (!file.type.startsWith(`${kind}/`)) { setError(`请选择${label}文件。`); return }
    uploadActive.current = true
    setError('')
    setPreviewRetry(null)
    setUploadProgress(0)
    try {
      const asset = await upload(`/projects/${projectId}/assets`, file, setUploadProgress)
      if (asset.kind !== kind) { setError(`请选择${label}文件。`); return }
      setAssets((previous) => ({ ...previous, [asset.id]: asset }))
      assignNodeAsset(id, asset)
    } catch (reason) {
      setPreviewRetry({ id, kind, file })
      setError(`${label}素材导入失败：${(reason as Error).message}`)
    } finally {
      uploadActive.current = false
      setUploadProgress(null)
    }
  }, [assignNodeAsset, projectId])

  useEffect(() => {
    const selectedNode = selected.length === 1 ? canvas.document.nodes.find((node) => node.id === selected[0]) : undefined
    onAgentNodeChange?.(selectedNode ? {
      id: selectedNode.id,
      type: selectedNode.type,
      name: selectedNode.name ?? '',
      text: selectedNode.text,
      assetId: selectedNode.asset_id,
      durationSeconds: selectedNode.duration_seconds,
      model: selectedNode.generation?.model,
      mode: selectedNode.type === 'image_generation' ? imageReferences(incomingReferences(canvas.document, selectedNode.id, assets)).length ? 'reference' : 'text' : selectedNode.generation?.mode,
    } : null)
  }, [assets, canvas.document, onAgentNodeChange, selected])

  useEffect(() => () => onAgentNodeChange?.(null), [onAgentNodeChange])

  const fittedViewport = useCallback((document: Document, editor?: { id: string; height: number }, focus = false) => {
    const nodes = document.nodes
    const rect = canvasElement.current?.getBoundingClientRect()
    if (!rect?.width || !rect.height) return null
    if (!nodes.length) return { x: 0, y: 0, zoom: 1 }
    const editedNode = editor ? nodes.find((node) => node.id === editor.id) : undefined
    const left = Math.min(...nodes.map((node) => node.x), editedNode ? editedNode.x - 16 : Infinity)
    const top = Math.min(...nodes.map((node) => node.y))
    const right = Math.max(...nodes.map((node) => node.x + node.width), editedNode ? editedNode.x + editedNode.width + 16 : -Infinity)
    const bottom = Math.max(...nodes.map((node) => node.y + node.height), editedNode && editor ? editedNode.y + editedNode.height + 14 + editor.height : -Infinity)
    const paddingX = Math.min(100, Math.max(32, rect.width * .1))
    const paddingY = Math.min(180, Math.max(100, rect.height * .16))
    const paddingTop = focus ? 80 : paddingY
    const paddingBottom = focus ? rect.width <= 1100 ? 148 : 88 : paddingY
    const zoom = Math.max(.02, Math.min(1, (rect.width - paddingX * 2) / (right - left), (rect.height - paddingTop - paddingBottom) / (bottom - top)))
    return {
      zoom,
      x: (rect.width - (right - left) * zoom) / 2 - left * zoom,
      y: (rect.height + paddingTop - paddingBottom - (bottom - top) * zoom) / 2 - top * zoom,
    }
  }, [])

  const convertToVideo = useCallback((id: string) => {
    const current = canvas.current.current
    const original = current.nodes.find((node) => node.id === id && node.type === 'shape' && !node.text.trim())
    if (!original) return
    const name = original.name && !/^形状 \d+$/.test(original.name) ? original.name : defaultNodeName('video', current.nodes)
    const converted: Node = { ...original, type: 'video', name, duration_seconds: 5, ...generationNodeSize }
    const next = { ...current, nodes: current.nodes.map((node) => node.id === id ? converted : node) }
    canvas.apply(next)
    setSelected([id])
    setSelectedEdges([])
  }, [canvas])

  const flowNodes = useMemo<CanvasFlowNode[]>(() => canvas.document.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    width: node.width,
    height: node.height,
    // 节点外框严格使用文档尺寸，重建受控节点时也保留框架所需的尺寸信息。
    measured: { width: node.width, height: node.height },
    dragging: draggingNode && selected.includes(node.id),
    // 受控节点预设的命中坐标须与 CSS 圆点一致，避免连线仍吸附旧的 8px 位置。
    handles: node.type !== 'group' ? [
      { type: 'target', position: Position.Left, x: -16, y: node.height / 2 + (isGenerationNode(node) ? 21 : 0) - 16, width: 32, height: 32 },
      { type: 'source', position: Position.Right, x: node.width - 16, y: node.height / 2 + (isGenerationNode(node) ? 21 : 0) - 16, width: 32, height: 32 },
    ] : undefined,
    selected: selected.includes(node.id),
    zIndex: node.type === 'group' ? -1 : selected.includes(node.id) ? 2 : 1,
    dragHandle: '.media-node-drag-handle, .media-node-drag-surface',
    ariaLabel: node.name || nodeTypeLabel(node.type),
    data: {
      projectId,
      onSave: canvas.save,
      onGenerationTask,
      source: node,
      asset: assets[node.asset_id ?? ''],
      assetsLoading,
      references: incomingReferences(canvas.document, node.id, assets),
      referenceCandidates: canvas.document.nodes.filter((source) => source.id !== node.id && source.type !== 'group' && !canvas.document.edges.some((edge) => edge.source === source.id && edge.target === node.id)),
      onReferenceChange: changeReference,
      frame: canvas.document.frame,
      zoom: canvas.document.viewport.zoom,
      onTextChange: updateText,
      onPatch: patchNode,
      onOpenAssets: openAssets,
      onOpenNodeAssets: openNodeAssets,
      onUploadNodeAsset: uploadNodeAsset,
      onConvertToVideo: convertToVideo,
      onInteractionStart: beginInteraction,
      onInteractionEnd: endInteraction,
      editorOpen: selected.length === 1 && selected[0] === node.id && !nodeMenu && !contextMenu,
      onCloseEditor: () => setSelected([]),
    },
  })), [assets, assetsLoading, beginInteraction, canvas.document, canvas.save, changeReference, contextMenu, convertToVideo, draggingNode, endInteraction, nodeMenu, onGenerationTask, openAssets, openNodeAssets, patchNode, projectId, selected, updateText, uploadNodeAsset])

  const flowEdges = useMemo<FlowEdge[]>(() => canvas.document.edges.map((edge) => ({
    ...edge,
    type: 'reference',
    selected: selectedEdges.includes(edge.id),
    style: { stroke: selectedEdges.includes(edge.id) ? '#c5c5c5' : '#858585', strokeWidth: selectedEdges.includes(edge.id) ? 2 : 1.5 },
  })), [canvas.document.edges, selectedEdges])

  const fetchAssets = useCallback(async () => {
    const all: Asset[] = []
    let page = 1
    while (true) {
      const result = await api<{ items: Asset[]; total: number }>(`/projects/${projectId}/assets?page=${page}&page_size=100`)
      all.push(...result.items)
      if (all.length >= result.total) break
      page++
    }
    setAssets(Object.fromEntries(all.map((asset) => [asset.id, asset])))
  }, [projectId])

  useEffect(() => {
    void api<Project>(`/projects/${projectId}`)
      .then(async (result) => { setProject(result); await fetchAssets() })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setAssetsLoading(false))
  }, [fetchAssets, projectId])

  useEffect(() => {
    const assetId = new URLSearchParams(location.search).get('addAsset')
    const asset = assetId ? assets[assetId] : undefined
    if (!canvas.ready || !asset || importedFromLibrary.current === asset.id) return
    const params = new URLSearchParams(location.search)
    const targetNodeId = params.get('targetNode')
    const targetKind = params.get('targetKind')
    if (targetNodeId && (targetKind === 'image' || targetKind === 'audio' || targetKind === 'video')) {
      const target = canvas.current.current.nodes.find((node) => node.id === targetNodeId && (node.type === targetKind || targetKind === 'image' && node.type === 'image_generation' || targetKind === 'audio' && node.type === 'audio_generation' || targetKind === 'video' && node.type === 'video_asset'))
      if (!target || (target.type === 'video' ? asset.kind === 'audio' : asset.kind !== targetKind)) { queueMicrotask(() => setError('该素材不适用于目标节点，请重新选择。')); return }
      importedFromLibrary.current = asset.id
      const current = canvas.current.current
      canvas.apply({ ...current, nodes: current.nodes.map((node) => node.id === target.id ? { ...node, asset_id: asset.id } : node) })
      queueMicrotask(() => setSelected([target.id]))
      void navigate(`/media/projects/${projectId}/canvas`, { replace: true })
      return
    }
    importedFromLibrary.current = asset.id
    const current = canvas.current.current
    let x = (window.innerWidth / 2 - current.viewport.x) / current.viewport.zoom - 160
    let y = (window.innerHeight / 2 - current.viewport.y) / current.viewport.zoom - 130
    for (let attempts = 0; attempts < 20 && current.nodes.some((node) => Math.abs(node.x - x) < 30 && Math.abs(node.y - y) < 30); attempts++) { x += 40; y += 40 }
    const node: Node = { id: crypto.randomUUID(), type: asset.kind === 'video' ? 'video_asset' : asset.kind, name: asset.name.slice(0, 120), asset_id: asset.id, text: '', x, y, ...(asset.kind === 'audio' ? audioAssetNodeSize : { width: 360, height: 280 }) }
    canvas.apply({ ...current, nodes: [...current.nodes, node] })
    queueMicrotask(() => setSelected([node.id]))
    void navigate(`/media/projects/${projectId}/canvas`, { replace: true })
  }, [assets, canvas, location.search, navigate, projectId])

  function copySelection() {
    const current = canvas.current.current
    const ids = new Set(selected)
    for (const node of current.nodes) if (node.type === 'group' && ids.has(node.id)) for (const member of node.member_ids ?? []) ids.add(member)
    if (!ids.size) return
    clipboard.current = {
      projectId,
      nodes: current.nodes.filter((node) => ids.has(node.id)),
      edges: current.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
    }
    pasteCount.current = 0
    setClipboardProjectId(projectId)
  }

  function pasteSelection() {
    const copied = clipboard.current
    if (!copied?.nodes.length || copied.projectId !== projectId) return
    pasteCount.current += 1
    const offset = 48 * pasteCount.current
    const idMap = new Map(copied.nodes.map((node) => [node.id, crypto.randomUUID()]))
    const nodes = copied.nodes.map((node) => ({ ...node, id: idMap.get(node.id)!, text: node.text.replace(imageMentionPattern, (token, id: string) => idMap.has(id) ? imageMentionToken(idMap.get(id)!) : token), member_ids: node.member_ids?.map((id) => idMap.get(id)!), x: node.x + offset, y: node.y + offset }))
    const edges = copied.edges.map((edge) => ({ id: crypto.randomUUID(), source: idMap.get(edge.source)!, target: idMap.get(edge.target)! }))
    const current = canvas.current.current
    canvas.apply({ ...current, nodes: [...current.nodes, ...nodes], edges: [...current.edges, ...edges] })
    setSelected(nodes.map((node) => node.id))
    setSelectedEdges([])
  }

  function removeSelected() {
    if (!selected.length && !selectedEdges.length) return
    canvas.checkpoint()
    canvas.apply(removeSelection(canvas.current.current, selected, selectedEdges), false)
    setSelected([])
    setSelectedEdges([])
  }

  function groupSelected() {
    const result = groupSelection(canvas.current.current, selected)
    if (!result) { setError('请选择至少两个未分组的节点；分组尺寸不能超过 4000。'); return }
    canvas.apply(result.document)
    setSelected([result.groupId])
    setSelectedEdges([])
    setError('')
  }

  function ungroupSelected() {
    const current = canvas.current.current
    const members = current.nodes.filter((node) => node.type === 'group' && selected.includes(node.id)).flatMap((node) => node.member_ids ?? [])
    if (!members.length) return
    canvas.apply(ungroupSelection(current, selected))
    setSelected(members)
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null
      // 助手内的键盘操作与文字选区由浏览器处理，不能被画布节点快捷键接管。
      if (element?.closest('.studio-assistant,[contenteditable="true"],[role="textbox"]')) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && (
        selection.anchorNode?.parentElement?.closest('.studio-assistant') ||
        selection.focusNode?.parentElement?.closest('.studio-assistant')
      )) return
      if (element?.closest('dialog[open]')) return
      if (event.key === 'Escape') { setMenu(false); setNodeMenu(false); setContextMenu(null); setSelected([]); setSelectedEdges([]) }
      if (element?.closest('input,textarea,select,button,a,video,audio,[role="dialog"]')) return
      if (event.key.toLowerCase() === 'v' && !event.metaKey && !event.ctrlKey) setTool('select')
      if (event.key.toLowerCase() === 'h' && !event.metaKey && !event.ctrlKey) setTool('pan')
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(canvas.current.current.nodes.map((node) => node.id)) }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') { event.preventDefault(); if (event.shiftKey) ungroupSelected(); else groupSelected() }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected() }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) canvas.redo(); else canvas.undo()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); canvas.redo() }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    if (changes.some((change) => change.type === 'select' || change.type === 'remove')) setSelected((previous) => {
      const selected = new Set(previous)
      for (const change of changes) {
        if (change.type === 'remove' || change.type === 'select' && !change.selected) selected.delete(change.id)
        else if (change.type === 'select') selected.add(change.id)
      }
      return [...selected]
    })
    const positionChanged = changes.some((change) => change.type === 'position' && Boolean(change.position))
    if (!positionChanged && !changes.some((change) => change.type === 'remove' || change.type === 'dimensions' && Boolean(change.setAttributes))) return
    const apply = () => {
      const current = canvas.current.current
      const next = applyCanvasNodeChanges(current, changes)
      if (next === current) return
      if (!interactionActive.current) canvas.checkpoint()
      canvas.apply(next, false)
    }
    // 原生拖动事件在下一次鼠标移动前提交画面，避免受控节点用较早的坐标回绘。
    // 测量事件可能来自 React effect，不能同步刷新。
    if (changes.some((change) => change.type === 'position' && change.position && change.dragging !== undefined)) flushSync(apply)
    else apply()
  }, [canvas])

  const onEdgesChange = useCallback((changes: EdgeChange<FlowEdge>[]) => {
    const next = applyEdgeChanges(changes, flowEdges)
    if (changes.some((change) => change.type === 'select' || change.type === 'remove')) setSelectedEdges(next.filter((edge) => edge.selected).map((edge) => edge.id))
    if (!changes.some((change) => change.type === 'remove')) return
    const current = canvas.current.current
    canvas.apply(syncReferenceModes({ ...current, edges: next.map(({ id, source, target }) => ({ id, source, target })) }))
  }, [canvas, flowEdges])

  const onConnect = useCallback(({ source, target }: Connection) => {
    if (!source || !target || source === target) return
    const current = canvas.current.current
    if (!current.nodes.some((node) => node.id === source) || !current.nodes.some((node) => node.id === target)) return
    if (current.nodes.some((node) => (node.id === source || node.id === target) && node.type === 'group')) return
    if (current.edges.some((edge) => edge.source === source && edge.target === target)) return
    canvas.apply(connectReference(current, source, target))
  }, [canvas])

  async function action(fn: () => Promise<void>) {
    setError('')
    try { await fn() } catch (reason) { setError((reason as Error).message) }
  }

  function center(width: number, height: number) {
    const current = canvas.current.current
    const point = flow?.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }) ?? {
      x: (window.innerWidth / 2 - current.viewport.x) / current.viewport.zoom,
      y: (window.innerHeight / 2 - current.viewport.y) / current.viewport.zoom,
    }
    const origin = { x: point.x - width / 2, y: point.y - height / 2 }
    const overlaps = (x: number, y: number) => current.nodes.some((node) =>
      x < node.x + node.width + 24 && x + width + 24 > node.x &&
      y < node.y + node.height + 24 && y + height + 24 > node.y)
    for (let ring = 0; ring < 30; ring++) {
      const slots: [number, number][] = ring === 0 ? [[0, 0]] : [[ring, 0], [-ring, 0], [0, ring], [0, -ring], [ring, ring], [-ring, ring], [ring, -ring], [-ring, -ring]]
      for (const [col, row] of slots) {
        const x = origin.x + col * Math.max(380, width + 80)
        const y = origin.y + row * Math.max(280, height + 80)
        if (!overlaps(x, y)) return { x, y }
      }
    }
    return origin
  }

  function applyAgentPlan(plan: MediaCanvasPlan) {
    const current = canvas.current.current
    for (const operation of plan.operations) {
      if (operation.action === 'connect_nodes') {
        connectReference(current, operation.source_id, operation.target_id)
        continue
      }
      if (operation.action === 'add_video') for (const source of [...(operation.connect_from_ids ?? []), ...(operation.connect_from_id ? [operation.connect_from_id] : [])]) {
        if (!current.nodes.some(node => node.id === source && node.type !== 'group')) throw new Error('参考来源节点已失效，未修改任何节点。')
      }
      if (operation.action !== 'update_node') continue
      const target = current.nodes.find(node => node.id === operation.node_id)
      if (!target) throw new Error('目标节点已不存在，未修改任何节点。')
      if (operation.duration_seconds !== undefined && target.type !== 'video') throw new Error('目标不是生视频节点，未修改任何节点。')
      if (operation.model !== undefined && target.type !== 'video') throw new Error('目标不是生视频节点，未修改任何节点。')
      if (!operation.generation) continue
      if (target.type !== 'image_generation') throw new Error('目标不是生图节点，未修改任何节点。')
      const settings = { ...defaultGenerationSettings(), ...target.generation }
      for (const [key, value] of Object.entries(operation.expected_generation ?? {})) {
        if ((settings[key as keyof typeof settings] ?? '') !== value) throw new Error('节点参数已有新修改，请让助手重新读取画布，未覆盖当前编辑。')
      }
    }
    const nodes = [...current.nodes]
    const edges = [...current.edges]
    const affectedIds: string[] = []
    let previousVideo = selected.length === 1 ? nodes.find((node) => node.id === selected[0] && node.type === 'video') : undefined
    const place = (width: number, height: number, after?: Node) => {
      const x = after ? after.x + after.width + 120 : center(width, height).x
      let y = after ? after.y : center(width, height).y
      const overlaps = () => nodes.some((node) => x < node.x + node.width + 24 && x + width + 24 > node.x && y < node.y + node.height + 24 && y + height + 24 > node.y)
      while (overlaps()) y += height + 80
      return { x, y }
    }
    for (const operation of plan.operations) {
      if (operation.action === 'connect_nodes') {
        const connected = connectReference({ ...current, nodes, edges }, operation.source_id, operation.target_id)
        nodes.splice(0, nodes.length, ...connected.nodes)
        edges.splice(0, edges.length, ...connected.edges)
        affectedIds.push(operation.target_id)
        continue
      }
      if (operation.action === 'update_node') {
        const index = nodes.findIndex((node) => node.id === operation.node_id)
        if (index < 0) continue
        const target = nodes[index]
        if (!target) continue
        nodes[index] = { ...target, ...(operation.name !== undefined ? { name: operation.name.trim() || target.name || defaultNodeName(target.type, nodes) } : {}), ...(operation.text !== undefined ? { text: operation.text } : {}), ...(operation.duration_seconds !== undefined ? { duration_seconds: operation.duration_seconds } : {}), ...(operation.generation || operation.model !== undefined ? { generation: { ...defaultGenerationSettings(), ...target.generation, ...operation.generation, ...(operation.model !== undefined ? { model: operation.model } : {}) } } : {}) }
        affectedIds.push(operation.node_id)
        continue
      }
      if (operation.action === 'add_note') {
        const node: Node = { id: crypto.randomUUID(), type: 'note', asset_id: null, name: defaultNodeName('note', nodes), duration_seconds: 5, text: operation.text, ...place(280, 220, previousVideo), width: 280, height: 220 }
        nodes.push(node); affectedIds.push(node.id)
        continue
      }
      if (operation.action === 'add_image_generation') {
        const node: Node = { id: crypto.randomUUID(), type: 'image_generation', asset_id: null, name: operation.name.trim() || defaultNodeName('image_generation', nodes), duration_seconds: 5, text: operation.text, generation: { ...defaultGenerationSettings(), ratio: '1:1', sound: false }, ...place(generationNodeSize.width, generationNodeSize.height, previousVideo), ...generationNodeSize }
        nodes.push(node); affectedIds.push(node.id)
        previousVideo = node
        continue
      }
      if (operation.action === 'add_image' || operation.action === 'add_audio') {
        const type = operation.action === 'add_image' ? 'image' : 'audio'
        const size = type === 'image' ? { width: 360, height: 280 } : audioAssetNodeSize
        const node: Node = { id: crypto.randomUUID(), type, asset_id: null, name: operation.name.trim() || defaultNodeName(type, nodes), duration_seconds: 5, text: operation.text, ...place(size.width, size.height, previousVideo), ...size }
        nodes.push(node); affectedIds.push(node.id)
        continue
      }
      // 顺序只影响排布；只有明确指定引用时才连线，不把分镜顺序当成素材依赖。
      const requestedSource = operation.connect_from_id ? nodes.find((node) => node.id === operation.connect_from_id) : undefined
      const node: Node = { id: crypto.randomUUID(), type: 'video', asset_id: null, name: operation.name.trim() || defaultNodeName('video', nodes), duration_seconds: operation.duration_seconds, ...(operation.model ? { generation: operation.generation ?? { ...defaultGenerationSettings(), model: operation.model } } : {}), text: operation.text, ...place(generationNodeSize.width, generationNodeSize.height, requestedSource ?? previousVideo), ...generationNodeSize }
      nodes.push(node); affectedIds.push(node.id)
      for (const source of [...(operation.connect_from_ids ?? []), ...(operation.connect_from_id ? [operation.connect_from_id] : [])]) {
        const connected = connectReference({ ...current, nodes, edges }, source, node.id)
        nodes.splice(0, nodes.length, ...connected.nodes)
        edges.splice(0, edges.length, ...connected.edges)
      }
      previousVideo = node
    }
    if (!affectedIds.length) return
    canvas.apply({ ...current, nodes, edges })
    setSelected([...new Set(affectedIds)])
    setSelectedEdges([])
    setError('')
  }

  useEffect(() => { agentPlanApplyRef.current = applyAgentPlan })
  useEffect(() => {
    if (!canvas.ready) { onAgentCanvasApplyChange?.(null); return }
    const apply = (plan: MediaCanvasPlan) => agentPlanApplyRef.current(plan)
    onAgentCanvasApplyChange?.(apply)
    return () => onAgentCanvasApplyChange?.(null)
  }, [canvas.ready, onAgentCanvasApplyChange])

  function addNode(type: 'video' | 'image_generation' | 'audio_generation' | 'video_asset' | 'image' | 'audio' | 'note' | 'text' | 'shape') {
    const current = canvas.current.current
    const size = isGenerationNode({ type }) ? generationNodeSize : type === 'image' || type === 'video_asset' ? { width: 360, height: 280 } : type === 'audio' ? audioAssetNodeSize : type === 'note' ? { width: 280, height: 220 } : type === 'text' ? { width: 320, height: 150 } : { width: 240, height: 150 }
    const name = defaultNodeName(type, current.nodes)
    const position = paletteAnchor ? { x: paletteAnchor.flowX, y: paletteAnchor.flowY } : center(size.width, size.height)
    const overlaps = () => current.nodes.some((item) => item.type !== 'group' && position.x < item.x + item.width + 24 && position.x + size.width + 24 > item.x && position.y < item.y + item.height + 24 && position.y + size.height + 24 > item.y)
    while (overlaps()) position.y += size.height + 80
    const node: Node = { id: crypto.randomUUID(), type, asset_id: null, name, duration_seconds: 5, text: '', ...(type === 'image_generation' ? { generation: { ...defaultGenerationSettings(), ratio: '1:1' as const, sound: false } } : {}), ...position, ...size }
    const connection = paletteAnchor?.connection
    const edge = connection ? { id: crypto.randomUUID(), source: connection.side === 'right' ? connection.id : node.id, target: connection.side === 'right' ? node.id : connection.id } : null
    const next = { ...current, nodes: [...current.nodes, node], edges: edge ? [...current.edges, edge] : current.edges }
    canvas.apply(next)
    setSelected([node.id])
    setSelectedEdges([])
    setNodeMenu(false)
    setPaletteAnchor(null)
  }

  async function importFiles(event: DragEvent) {
    event.preventDefault()
    setDraggingFile(false)
    const files = [...event.dataTransfer.files]
    if (!files.length) return
    setError('')
    const point = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? center(320, 260)
    try {
      for (const [index, file] of files.entries()) {
        setUploadProgress(0)
        const asset = await upload(`/projects/${projectId}/assets`, file, setUploadProgress)
        setAssets((previous) => ({ ...previous, [asset.id]: asset }))
        const node: Node = { id: crypto.randomUUID(), type: asset.kind === 'video' ? 'video_asset' : asset.kind, name: asset.name.slice(0, 120), asset_id: asset.id, text: '', x: point.x + index * 36, y: point.y + index * 36, ...(asset.kind === 'audio' ? audioAssetNodeSize : { width: 360, height: 280 }) }
        const current = canvas.current.current
        canvas.apply({ ...current, nodes: [...current.nodes, node] })
        setSelected([node.id])
      }
    } catch (reason) { setError(`素材导入失败：${(reason as Error).message}`) }
    finally { setUploadProgress(null) }
  }

  function updateViewport(viewport: Viewport) {
    const current = canvas.current.current
    if (current.viewport.x === viewport.x && current.viewport.y === viewport.y && current.viewport.zoom === viewport.zoom) return
    canvas.apply({ ...current, viewport }, false)
  }

  function zoom(delta: number) {
    const current = canvas.current.current
    const viewport = current.viewport
    const nextZoom = Math.max(.02, Math.min(4, Math.round((viewport.zoom + delta) * 100) / 100))
    const centerX = window.innerWidth / 2
    const centerY = window.innerHeight / 2
    canvas.apply({
      ...current,
      viewport: {
        zoom: nextZoom,
        x: centerX - (centerX - viewport.x) * nextZoom / viewport.zoom,
        y: centerY - (centerY - viewport.y) * nextZoom / viewport.zoom,
      },
    }, false)
  }

  function fit(selectedOnly = false) {
    const current = canvas.current.current
    const editor = canvasElement.current?.querySelector<HTMLElement>('.media-node-editor:not([aria-hidden="true"])')
    const target = selectedOnly ? { ...current, nodes: current.nodes.filter((node) => selected.includes(node.id)) } : current
    if (selectedOnly && !target.nodes.length) return
    const viewport = fittedViewport(target, editor?.dataset.nodeId ? { id: editor.dataset.nodeId, height: editor.offsetHeight } : undefined, selectedOnly)
    if (viewport) canvas.apply({ ...current, viewport }, false)
  }

  function arrange() {
    try {
      const current = canvas.current.current
      const element = canvasElement.current?.querySelector<HTMLElement>('.media-node-editor:not([aria-hidden="true"])')
      const editor = element?.dataset.nodeId ? { id: element.dataset.nodeId, height: element.offsetHeight } : undefined
      const next = arrangeCanvas(current, editor)
      const viewport = fittedViewport(next, editor) ?? current.viewport
      if (next === current && viewport.x === current.viewport.x && viewport.y === current.viewport.y && viewport.zoom === current.viewport.zoom) return
      canvas.apply({ ...next, viewport }, next !== current)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '画布排版失败，请重试。')
    }
  }

  async function fork() {
    const newProject = await api<Project>('/projects', 'POST', { name: `${project?.name ?? '作品'}（本地副本）`.slice(0, 120) })
    const ids = [...new Set(canvas.current.current.nodes.flatMap((node) => node.asset_id ? [node.asset_id] : []))]
    await api(`/projects/${projectId}/copy-assets/${newProject.id}`, 'POST', { asset_ids: ids })
    await api(`/projects/${newProject.id}/canvas`, 'PUT', { version: 0, document: canvas.current.current })
    void navigate(`/media/projects/${newProject.id}/canvas`)
  }

  const viewport = canvas.document.viewport
  return <main className="media-editor">
    <div className="media-project-menu"><div className="media-project-controls"><button className="media-project-back" aria-label="返回作品页" title="返回作品页" onClick={() => void action(async () => { await canvas.save(); void navigate(`/media/projects/${projectId}`) })}><ArrowLeft size={17} /></button><button className="media-project-trigger" aria-expanded={menu} aria-label="作品菜单" onClick={() => { setMenu(!menu); setNodeMenu(false) }}><span className="media-project-name">{project?.name ?? '作品'}</span><ChevronDown size={15} /></button><FpsStatusSlot /></div>{menu && <div className="media-menu-content"><p role="status">{canvas.status}</p><label className="media-background-setting">画布背景<select aria-label="画布背景" value={canvas.document.background} onChange={(event) => canvas.apply({ ...canvas.current.current, background: event.target.value as Document['background'] })}><option value="dots">点阵</option><option value="lines">网格</option><option value="none">纯色</option></select></label><button onClick={() => void action(async () => { await canvas.save(); void navigate(`/media/projects/${projectId}/assets`) })}>作品素材库</button><button disabled={!project} onClick={() => setRenameOpen(true)}>重命名作品</button><button onClick={() => void action(canvas.save)}>立即保存 / 重试</button></div>}</div>
    {(error || canvas.status.startsWith('保存失败') || canvas.conflict || !canvas.ready) && <div className="media-editor-notice" role="status">{error || canvas.status}{previewRetry ? <button onClick={() => void uploadNodeAsset(previewRetry.id, previewRetry.kind, previewRetry.file)}>重试上传</button> : <button onClick={() => void action(canvas.ready ? canvas.save : () => canvas.load(true))}>重试</button>}{canvas.conflict && <><button onClick={() => setReloadOpen(true)}>重新加载</button><button onClick={() => void action(fork)}>保留为新作品</button></>}<button onClick={() => void navigate(`/media/projects/${projectId}`)}>作品页</button></div>}
    {renameOpen && project && <ProjectDialog action={{ kind: 'rename', project }} onClose={() => setRenameOpen(false)} onSaved={(updated) => { if (updated) setProject(updated); setRenameOpen(false) }} />}
    {assetTarget && <CanvasAssetPicker projectId={projectId} target={assetTarget} onClose={() => setAssetTarget(null)} onSelect={async (asset) => {
      if (assetTarget.allowImageForVideo ? asset.kind === 'audio' : asset.kind !== assetTarget.kind) throw new Error('该素材不适用于当前节点，请重新选择。')
      await api(`/projects/${projectId}/assets/reference`, 'POST', { asset_id: asset.id })
      setAssets((previous) => ({ ...previous, [asset.id]: asset }))
      assignNodeAsset(assetTarget.id, asset)
      setAssetTarget(null)
    }} />}
    <dialog ref={reloadDialog} className="media-home-dialog" aria-labelledby="canvas-reload-title" aria-describedby="canvas-reload-description" onCancel={() => setReloadOpen(false)} onClose={() => setReloadOpen(false)}>
      <h2 id="canvas-reload-title">加载服务器版本？</h2><p id="canvas-reload-description">当前本地修改会被替换。需要保留时，请取消并选择“保留为新作品”。</p><footer><button autoFocus type="button" onClick={() => setReloadOpen(false)}>取消</button><button type="button" onClick={() => { setReloadOpen(false); void action(() => canvas.load()) }}>放弃本地修改并加载</button></footer>
    </dialog>
    <div ref={canvasElement} className={`media-canvas ${draggingFile ? 'is-file-over' : ''} ${connecting ? 'is-connecting' : ''}`} aria-label="作品无限画布" onDoubleClick={(event) => {
      if (!(event.target as HTMLElement).classList.contains('react-flow__pane')) return
      event.preventDefault()
      const point = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      if (!point) return
      setPaletteAnchor({ x: event.clientX, y: event.clientY, flowX: point.x, flowY: point.y }); setNodeMenu(true); setMenu(false); setContextMenu(null)
    }} onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDraggingFile(true) } }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDraggingFile(false) }} onDrop={(event) => void importFiles(event)}>
      {canvas.ready && <ReactFlow<CanvasFlowNode>
        elevateNodesOnSelect={false}
        nodes={flowNodes}
        edges={flowEdges}
        connectionLineType={ConnectionLineType.Bezier}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        viewport={viewport}
        minZoom={.02}
        maxZoom={4}
        nodesConnectable
        nodesDraggable={!wheelPanning || draggingNode}
        connectionRadius={28}
        selectionOnDrag={tool === 'select'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={tool === 'pan' ? [0, 1] : [1]}
        panOnScroll
        noWheelClassName={wheelPanning ? 'media-wheel-isolated' : 'nowheel'}
        zoomOnDoubleClick={false}
        panActivationKeyCode="Space"
        zoomOnScroll={false}
        zoomActivationKeyCode={['Meta', 'Control']}
        multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
        deleteKeyCode={null}
        onInit={setFlow}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={() => setConnecting(true)}
        onConnectEnd={(event, state) => {
          setConnecting(false)
          if (state.isValid || !state.fromNode) return
          if (state.toHandle) return
          const pointer = 'changedTouches' in event ? event.changedTouches[0] : event
          if (!pointer) return
          const { clientX, clientY } = pointer
          // 复用原生拖线，松手时将节点内容作为落点；编辑面板不接收连线。
          const element = document.elementFromPoint(clientX, clientY)
          const dropNode = element?.closest<HTMLElement>('.react-flow__node')
          if (dropNode && canvasElement.current?.contains(dropNode)) {
            if (element?.closest('.media-node-editor, .media-node-media-actions')) return
            const dropId = dropNode.dataset.id
            if (dropId) onConnect({
              source: state.fromHandle?.type === 'target' ? dropId : state.fromNode.id,
              target: state.fromHandle?.type === 'target' ? state.fromNode.id : dropId,
              sourceHandle: null,
              targetHandle: null,
            })
            return
          }
          if (state.toNode) return
          const origin = state.from
          if (origin && Math.hypot(clientX - origin.x, clientY - origin.y) < 8) return
          const point = flow?.screenToFlowPosition({ x: clientX, y: clientY })
          if (!point) return
          setPaletteAnchor({ x: clientX, y: clientY, flowX: point.x, flowY: point.y, connection: { id: state.fromNode.id, side: state.fromHandle?.type === 'target' ? 'left' : 'right' } })
          setNodeMenu(true); setMenu(false); setContextMenu(null)
        }}
        onPaneClick={() => {
          setSelected([]); setSelectedEdges([]); setNodeMenu(false); setMenu(false); setContextMenu(null)
        }}
        onPaneContextMenu={(event) => {
          event.preventDefault()
          const point = flow?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
          if (!point) return
          setPaletteAnchor({ x: event.clientX, y: event.clientY, flowX: point.x, flowY: point.y }); setNodeMenu(true); setMenu(false); setContextMenu(null)
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault()
          if (!selected.includes(node.id)) { setSelected([node.id]); setSelectedEdges([]) }
          setContextMenu({ x: event.clientX, y: event.clientY }); setNodeMenu(false); setMenu(false)
        }}
        autoPanOnNodeDrag={false}
        autoPanOnNodeFocus={false}
        onNodeDragStart={() => { beginInteraction(); setDraggingNode(true) }}
        onNodeDragStop={() => { endInteraction(); setDraggingNode(false) }}
        onMoveStart={(event, next) => { if (event?.type === 'wheel') setWheelPanning(true); updateViewport(next) }}
        onMove={(_, next) => updateViewport(next)}
        onMoveEnd={(_, next) => { setWheelPanning(false); updateViewport(next) }}
        proOptions={{ hideAttribution: true }}
      >{canvas.document.background !== 'none' && <Background variant={canvas.document.background === 'lines' ? BackgroundVariant.Lines : BackgroundVariant.Dots} color="#383838" gap={24} size={1} />}{showMiniMap && !nodeMenu && <MiniMap pannable zoomable position="bottom-right" maskColor="#191919cc" nodeColor={(node) => node.selected ? '#c5c5c5' : '#686868'} />}</ReactFlow>}
      {draggingFile && <div className="media-canvas-drop" aria-hidden="true">松开鼠标，将素材放入画布</div>}
      {uploadProgress !== null && <div className="media-canvas-upload" role="status">正在导入素材 · {uploadProgress}%</div>}
      {canvas.ready && canvas.document.nodes.length === 0 && !nodeMenu && <div className="media-canvas-empty"><small>影像创作空间</small><h1>从一个画面开始。</h1><p>创建生图或生视频节点，填写提示词并连接参考素材。</p><div className="media-canvas-empty-actions"><button className="media-accent" onClick={() => addNode('image_generation')}>＋ 添加生图节点</button><button onClick={() => addNode('video')}>＋ 添加生视频节点</button><button onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>打开作品素材库</button></div></div>}
    </div>
    {nodeMenu && <div ref={nodeMenuElement} id="media-node-palette" className={`media-node-palette ${paletteAnchor ? 'is-contextual' : ''}`} style={paletteAnchor ? { left: Math.max(12, Math.min(window.innerWidth - 284, paletteAnchor.x)), top: Math.max(76, Math.min(window.innerHeight - 440, paletteAnchor.y)) } : undefined} role="dialog" aria-label="添加节点">
      <div className="media-node-palette-heading"><strong>添加节点</strong><button type="button" aria-label="关闭节点菜单" onClick={() => setNodeMenu(false)}>×</button></div>
      <div className="media-node-palette-separator">生成</div>
      <div className="media-node-palette-grid">
        <button type="button" onClick={() => addNode('image_generation')}><ImagePlus /><span>生图节点</span></button>
        <button type="button" onClick={() => addNode('video')}><Film /><span>生视频节点</span></button>
        <button type="button" onClick={() => addNode('audio_generation')}><Music2 /><span>生音频节点</span></button>
      </div>
      <div className="media-node-palette-separator">素材与内容</div>
      <div className="media-node-palette-grid">
        <button type="button" onClick={() => addNode('text')}><Type /><span>文本</span></button>
        <button type="button" onClick={() => addNode('image')}><ImagePlus /><span>图片节点</span></button>
        <button type="button" onClick={() => addNode('video_asset')}><Film /><span>视频节点</span></button>
        <button type="button" onClick={() => addNode('audio')}><Music2 /><span>音频</span></button>
        <button type="button" onClick={() => addNode('note')}><StickyNote /><span>便签</span></button>
        <button type="button" onClick={() => addNode('shape')}><Shapes /><span>形状</span></button>
      </div>
      <div className="media-node-palette-separator">添加资源</div>
      <button className="media-node-palette-resource" type="button" onClick={() => void navigate(`/media/projects/${projectId}/assets`)}><Upload /><span>上传或从素材库选择</span></button>
    </div>}
    {contextMenu && <div className="media-node-context-menu" role="group" aria-label="节点操作" style={{ left: Math.max(12, Math.min(window.innerWidth - 200, contextMenu.x)), top: Math.max(76, Math.min(window.innerHeight - 240, contextMenu.y)) }}>
      <button autoFocus onClick={() => { copySelection(); setContextMenu(null) }}>复制节点<span>⌘/Ctrl C</span></button>
      <button onClick={() => { copySelection(); pasteSelection(); setContextMenu(null) }}>创建副本</button>
      <button disabled={selected.length < 2} onClick={() => { groupSelected(); setContextMenu(null) }}>编组<span>⌘/Ctrl G</span></button>
      <button onClick={() => { removeSelected(); setContextMenu(null) }}>移除节点<span>Delete</span></button>
    </div>}
    {(selected.filter((id) => canvas.document.nodes.some((node) => node.id === id && node.type !== 'group')).length >= 2 || selected.some((id) => canvas.document.nodes.some((node) => node.id === id && node.type === 'group'))) && <div className="media-canvas-selection-actions"><span>已选 {selected.length} 个节点</span><button onClick={groupSelected} disabled={selected.filter((id) => canvas.document.nodes.some((node) => node.id === id && node.type !== 'group')).length < 2}>编组</button><button onClick={ungroupSelected} disabled={!selected.some((id) => canvas.document.nodes.some((node) => node.id === id && node.type === 'group'))}>取消编组</button></div>}
    <div className="media-canvas-toolbar" role="toolbar" aria-label="创作工具"><button ref={nodeMenuTrigger} className="media-add-node-button" aria-controls="media-node-palette" aria-expanded={nodeMenu} disabled={!canvas.ready} onClick={() => { setPaletteAnchor(null); setNodeMenu(!nodeMenu); setContextMenu(null); setMenu(false) }}>＋ 添加节点</button><button disabled={!canvas.ready} onClick={() => void navigate(`/media/projects/${projectId}/assets`)}>素材库</button><button aria-label="选择" title="选择 V" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={17} /></button><button aria-label="平移" title="平移 H，按住空格临时平移" aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Hand size={17} /></button><button className="media-canvas-layout" type="button" aria-label="一键排版" title="一键排版：参考在左，成品在右" disabled={!canvas.ready || !canvas.document.nodes.length} onClick={arrange}><Workflow size={17} /><span>排版</span></button><button aria-label="复制节点" title="复制节点 ⌘/Ctrl+C" disabled={!selected.length} onClick={copySelection}><Copy size={16} /></button><button aria-label="粘贴节点" title="粘贴节点 ⌘/Ctrl+V" disabled={clipboardProjectId !== projectId} onClick={pasteSelection}><ClipboardPaste size={16} /></button><button aria-label="撤销" onClick={canvas.undo}>↶</button><button aria-label="重做" onClick={canvas.redo}>↷</button><button disabled={!selected.length && !selectedEdges.length} onClick={removeSelected}>移除</button></div>
    <div className="media-canvas-view-tools" role="toolbar" aria-label="画布视图"><button aria-label="切换小地图" aria-pressed={showMiniMap} title="小地图" onClick={() => setShowMiniMap(!showMiniMap)}><MapIcon size={16} /></button><button aria-label="缩小画布" title="缩小 10%" onClick={() => zoom(-.1)}>−</button><output aria-label="当前缩放比例">{Math.round(viewport.zoom * 100)}%</output><button aria-label="放大画布" title="放大 10%" onClick={() => zoom(.1)}>＋</button><button disabled={!selected.length} onClick={() => fit(true)}>聚焦所选</button><button onClick={() => fit()}>适应全部</button></div>
  </main>
}
