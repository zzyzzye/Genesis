import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, LoaderCircle, RefreshCw } from 'lucide-react'
import { api, MediaError, defaultGenerationSettings, type GenerationSettings, type Node } from './api'
import type { BillingOperation } from '../../features/billing/api'
import { getStoredAuthToken } from '../../lib/auth'
import { createModelCatalogCache } from '../../lib/modelCatalogCache'
import type { ModelPricePreview } from '../../lib/api'
import { GenerationModelPicker } from './GenerationModelPicker'

export type VideoModel = { id: string; description?: string; pricing?: ModelPricePreview | null }
type ModelList = { configured: boolean; references_ready: boolean; models: VideoModel[]; billing_required?: boolean }
const generationCatalog = createModelCatalogCache<ModelList>()
export type GenerationTask = { id: string; node_id: string; status: string; progress: number; error: string; asset_id: string | null; asset_ids?: string[]; generation?: GenerationSettings | null; billing?: BillingOperation | null }
type Task = GenerationTask
const running = (status: string) => ['submitting', 'queued', 'processing', 'downloading'].includes(status)

type GenerationProps = {
  projectId: string
  node: Node
  onPatch: (patch: Partial<Node>) => void
  onSave: () => Promise<void>
  onTask?: (task: GenerationTask, createResults?: boolean) => void
  onModelChange?: (model: VideoModel | null) => void
  referenceCount?: number
  referencesPending?: boolean
  referenceError?: string
  controls?: ReactNode
}
export function VideoGeneration(props: GenerationProps) {
  return <GenerationControls {...props} kind="video" />
}
export function ImageGeneration(props: GenerationProps) {
  return <GenerationControls {...props} kind="image" />
}
function GenerationControls({ projectId, node, onPatch, onSave, onTask, onModelChange, referenceCount = 0, referencesPending = false, referenceError, controls, kind }: GenerationProps & { kind: 'video' | 'image' }) {
  const isImage = kind === 'image'
  const noun = isImage ? '图片' : '视频'
  const modelsPath = `/${kind}-models`
  const tasksPath = `/projects/${projectId}/${kind}-generations`
  const [catalog, setCatalog] = useState<ModelList | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const forceCatalogRefresh = useRef(false)
  const requestId = useRef<string | null>(null)
  const active = useRef(false)
  const model = catalog?.models.find((item) => item.id === node.generation?.model)
  useEffect(() => { onModelChange?.(model ?? null) }, [model, onModelChange])
  useEffect(() => {
    let current = true
    const refresh = forceCatalogRefresh.current
    forceCatalogRefresh.current = false
    void generationCatalog(getStoredAuthToken() ?? '', modelsPath, () => api<ModelList>(`${modelsPath}${refresh ? '?refresh=true' : ''}`), refresh).then((data) => {
      if (!data || !Array.isArray(data.models)) throw new Error(`${noun}模型目录格式无效，请重试`)
      if (current) { setCatalog(data); setCatalogError('') }
    }).catch((reason: Error) => { if (current) setCatalogError(reason.message) }).finally(() => { if (current) setCatalogLoading(false) })
    return () => { current = false }
  }, [catalogRevision, modelsPath, noun])
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const tasks = await api<Task[]>(`${tasksPath}?node_id=${node.id}`)
        if (!current) return
        setTask(tasks[0] ?? null)
        if (tasks[0]) onTask?.(tasks[0], false)
        if (tasks.some(row => row.id === requestId.current)) requestId.current = null
        setError('')
        if (tasks[0] && running(tasks[0].status)) timer = setTimeout(() => { void refresh() }, 2000)
      } catch (reason) {
        if (current) { setError((reason as Error).message); timer = setTimeout(() => { void refresh() }, 15000) }
      }
    }
    void refresh()
    return () => { current = false; clearTimeout(timer) }
  }, [tasksPath, node.id, attempt, isImage, onTask])

  const refreshModels = () => {
    if (catalogLoading || busy) return
    setCatalogLoading(true)
    setCatalogError('')
    forceCatalogRefresh.current = true
    setCatalogRevision(value => value + 1)
  }
  const chooseModel = (id: string) => {
    const selected = catalog?.models.find((item) => item.id === id)
    if (!selected) return
    const settings = node.generation ?? defaultGenerationSettings()
    if (isImage) {
      onPatch({ generation: { ...settings, model:id } })
      return
    }
    onPatch({ generation: { ...settings, model:id, count:1 } })
  }
  const submit = useCallback(async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      await onSave()
      // 主动核实后的重新提交是新意图；普通断网重试继续复用原标识。
      if (acknowledged) requestId.current = null
      requestId.current ??= crypto.randomUUID()
      onTask?.({ id:requestId.current,node_id:node.id,status:'requesting',progress:0,error:'',asset_id:null })
      const created = await api<Task>(tasksPath, 'POST', { request_id:requestId.current, node_id:node.id, acknowledge_unknown:acknowledged })
      onTask?.(created)
      setTask(created); requestId.current = null; setAcknowledged(false); setAttempt((value) => value + 1)
    } catch (reason) {
      if (requestId.current) onTask?.({ id:requestId.current,node_id:node.id,status:reason instanceof MediaError && (reason.status < 500 || reason.status === 503) ? 'failed' : 'unknown',progress:0,error:(reason as Error).message,asset_id:null })
      if (reason instanceof MediaError && reason.status >= 400 && reason.status < 500) {
        requestId.current = null
        setError(`${reason.message}。请核对参数与余额后重试。`)
      } else if (reason instanceof MediaError) {
        setError(reason.message)
      } else setError(`${(reason as Error).message}。请先刷新任务状态；再次点击会使用同一请求标识。`)
    } finally { active.current = false; setBusy(false) }
  }, [onSave, tasksPath, node.id, acknowledged, onTask])
  const blocked = busy || Boolean(task && running(task.status)) || task?.status === 'unknown' && !acknowledged
  const referenceBlocked = referencesPending || Boolean(referenceError) || (!isImage && (node.generation?.mode ?? 'text') !== 'text' && catalog && !catalog.references_ready)
  return <div className="media-video-generation">
    <div className="media-video-generation-actions">
      <GenerationModelPicker models={catalog?.models ?? []} value={model?.id ?? ''} label={`${noun}生成模型`} placeholder={catalog ? catalog.configured ? `选择${noun}模型` : `尚未配置${noun}服务` : `加载${noun}模型…`} disabled={busy} loading={catalogLoading} onChange={chooseModel} onRefresh={refreshModels} />
      {isImage && <span className="media-video-spec" aria-label="图片生成模式" title="根据连入的图片参考自动确定">{referenceCount ? '图生图' : '文生图'}</span>}
      {controls}
      <button type="button" aria-label={`刷新${noun}模型与任务`} title="刷新模型与任务" disabled={busy || catalogLoading} onClick={() => { refreshModels(); setAttempt(value => value + 1) }}><RefreshCw size={14} /></button>
      <button type="button" className="media-video-submit" aria-label={`生成${noun}`} title={`生成${noun}`} disabled={Boolean(blocked || referenceBlocked || !model || !node.text.trim())} onClick={() => void submit()}>{busy || task && running(task.status) ? <LoaderCircle size={15} className="is-spinning" /> : <ArrowUp size={16} />}</button>
    </div>
    {catalog && !catalog.configured && <p>{noun}服务尚未配置，请先在服务端配置{noun} API Key。</p>}
    {catalog?.configured && !catalog.models.length && <p>暂无可用{noun}模型，可刷新重试。</p>}
    {referencesPending && <p role="status">参考图片尚未就绪，请先生成或导入图片，或断开该参考。</p>}
    {referenceError && <p role="status">{referenceError}</p>}
    {!isImage && !referencesPending && !referenceError && referenceBlocked && catalog?.configured && model && <p>参考素材暂不可用：需先部署公网地址并启用素材访问。</p>}
    {task?.status === 'download_failed' && <button type="button" disabled={busy} onClick={() => {
      setBusy(true)
      void api<Task>(`${tasksPath}/${task.id}/retry-download`, 'POST').then((next) => { onTask?.(next); setTask(next); setAttempt((value) => value + 1) }).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false))
    }}>重试保存{noun}</button>}
    {task?.status === 'unknown' && <label className="media-video-unknown"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />已核实上次任务，确认重新提交可能产生新的费用</label>}
    {(catalogError || error) && <p role="alert">{catalogError || error}</p>}
  </div>
}
