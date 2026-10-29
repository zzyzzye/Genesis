import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Check, LoaderCircle, RefreshCw } from 'lucide-react'
import { api, MediaError, defaultGenerationSettings, type Asset, type GenerationSettings, type Node } from './api'
import { AssetPreview } from './AssetPreview'
import { BillingStatus } from '../../features/billing/BillingControls'
import { useBillingQuote } from '../../features/billing/useBillingQuote'
import type { BillingOperation } from '../../features/billing/api'
import { getStoredAuthToken } from '../../lib/auth'
import { createModelCatalogCache } from '../../lib/modelCatalogCache'

export type VideoModel = { id: string; parameters_known?: boolean; ratios: string[]; resolutions: string[]; durations: number[]; images: number; videos: number; audio: boolean; image_edit?: boolean }
type ModelList = { configured: boolean; references_ready: boolean; models: VideoModel[]; billing_required?: boolean }
const generationCatalog = createModelCatalogCache<ModelList>()
type Task = { id: string; node_id: string; status: string; progress: number; error: string; asset_id: string | null; asset_ids?: string[]; billing?: BillingOperation | null }
const running = (status: string) => ['submitting', 'queued', 'processing', 'downloading'].includes(status)
const statusText: Record<string, string> = { submitting:'正在提交', queued:'排队中', processing:'生成中', downloading:'正在保存视频', download_failed:'视频保存失败', completed:'视频已生成', failed:'生成失败', unknown:'创建结果待核实', acknowledged:'已核实旧任务' }
const imageStatusText: Record<string, string> = { submitting:'正在提交',processing:'生成中',downloading:'正在保存图片',download_failed:'图片保存失败',completed:'图片已生成',failed:'生成失败',unknown:'创建结果待核实',acknowledged:'已核实旧任务' }

type GenerationProps = {
  projectId: string
  node: Node
  onPatch: (patch: Partial<Node>) => void
  onSave: () => Promise<void>
  onResult: (asset: Asset) => void
  onModelChange: (model: VideoModel | null) => void
  referenceCount?: number
  controls?: ReactNode
}
export function VideoGeneration(props: GenerationProps) {
  return <GenerationControls {...props} kind="video" />
}
export function ImageGeneration(props: GenerationProps) {
  return <GenerationControls {...props} kind="image" />
}
function GenerationControls({ projectId, node, onPatch, onSave, onResult, onModelChange, referenceCount = 0, controls, kind }: GenerationProps & { kind: 'video' | 'image' }) {
  const isImage = kind === 'image'
  const noun = isImage ? '图片' : '视频'
  const modelsPath = `/${kind}-models`
  const tasksPath = `/projects/${projectId}/${kind}-generations`
  const [catalog, setCatalog] = useState<ModelList | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [catalogRevision, setCatalogRevision] = useState(0)
  const forceCatalogRefresh = useRef(false)
  const requestId = useRef<string | null>(null)
  const quoteId = useRef<string | null>(null)
  const { confirmQuote, quoteDialog } = useBillingQuote()
  const active = useRef(false)
  const [results, setResults] = useState<Asset[]>([])
  const model = catalog?.models.find((item) => item.id === node.generation?.model)
  const resultKey = isImage && task?.status === 'completed' ? (task.asset_ids ?? (task.asset_id ? [task.asset_id] : [])).join(',') : ''
  useEffect(() => {
    let current = true
    if (!resultKey) return
    void Promise.all(resultKey.split(',').map((id) => api<Asset>(`/assets/${id}`))).then((assets) => {
      if (current) setResults(assets)
    }).catch(() => { if (current) setError('生成图片读取失败，请刷新重试') })
    return () => { current = false }
  }, [resultKey, attempt])
  useEffect(() => { onModelChange(model ?? null) }, [model, onModelChange])
  useEffect(() => {
    let current = true
    const refresh = forceCatalogRefresh.current
    forceCatalogRefresh.current = false
    void generationCatalog(getStoredAuthToken() ?? '', modelsPath, () => api<ModelList>(`${modelsPath}${refresh ? '?refresh=true' : ''}`), refresh).then((data) => {
      if (!data || !Array.isArray(data.models)) throw new Error(`${noun}模型目录格式无效，请重试`)
      if (current) { setCatalog(data); setCatalogError('') }
    }).catch((reason: Error) => { if (current) setCatalogError(reason.message) })
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
        if (tasks.some(row => row.id === requestId.current)) { requestId.current = null; quoteId.current = null }
        setError('')
        if (tasks[0] && running(tasks[0].status)) timer = setTimeout(() => { void refresh() }, isImage ? 2000 : 15000)
      } catch (reason) {
        if (current) { setError((reason as Error).message); timer = setTimeout(() => { void refresh() }, 15000) }
      }
    }
    void refresh()
    return () => { current = false; clearTimeout(timer) }
  }, [tasksPath, node.id, attempt, isImage])

  const chooseModel = (id: string) => {
    const selected = catalog?.models.find((item) => item.id === id)
    if (!selected) return
    const settings = node.generation ?? defaultGenerationSettings()
    if (isImage) {
      onPatch({ generation: { ...settings, model:id, mode: selected.image_edit === false ? 'text' : settings.mode } })
      return
    }
    if (selected.parameters_known === false) {
      onPatch({ generation: { ...settings, model:id, count:1, mode:'text' } })
      return
    }
    onPatch({ duration_seconds: selected.durations.includes(node.duration_seconds ?? 5) ? node.duration_seconds : selected.durations[0], generation: {
      ...settings, model:id, count:1,
      ratio: (selected.ratios.includes(settings.ratio) ? settings.ratio : selected.ratios[0]) as GenerationSettings['ratio'],
      resolution: (selected.resolutions.includes(settings.resolution.toLowerCase()) ? settings.resolution : (selected.resolutions[0] ?? settings.resolution).toUpperCase()) as GenerationSettings['resolution'],
      mode: selected.images + selected.videos === 0 && !selected.audio ? 'text' : settings.mode,
    } })
  }
  const submit = useCallback(async () => {
    if (active.current) return
    active.current = true; setBusy(true); setError('')
    try {
      await onSave()
      // 主动核实后的重新提交是新意图；普通断网重试继续复用原标识。
      if (acknowledged) { requestId.current = null; quoteId.current = null }
      if (catalog?.billing_required && !quoteId.current) {
        const quote = await confirmQuote({ kind, project_id:projectId, node_id:node.id })
        if (!quote) return
        quoteId.current = quote.id
      }
      requestId.current ??= crypto.randomUUID()
      const created = await api<Task>(tasksPath, 'POST', { request_id:requestId.current, node_id:node.id, acknowledge_unknown:acknowledged, ...(quoteId.current ? { quote_id:quoteId.current } : {}) })
      setTask(created); requestId.current = null; quoteId.current = null; setAcknowledged(false); setAttempt((value) => value + 1)
    } catch (reason) {
      if (reason instanceof MediaError && reason.status >= 400 && reason.status < 500) {
        requestId.current = null; quoteId.current = null
        setError(`${reason.message}。请核对参数与余额后重新确认预算。`)
      } else setError(`${(reason as Error).message}。请先刷新任务状态；再次点击会使用同一请求标识。`)
    } finally { active.current = false; setBusy(false) }
  }, [onSave, tasksPath, node.id, acknowledged, catalog, confirmQuote, kind, projectId])
  const blocked = busy || Boolean(task && running(task.status)) || task?.status === 'unknown' && !acknowledged
  const referenceBlocked = (node.generation?.mode ?? 'text') !== 'text' && catalog && (!catalog.references_ready || isImage && model?.image_edit === false)
  return <div className="media-video-generation">
    {quoteDialog}
    <div className="media-video-generation-actions">
      <select aria-label={`${noun}生成模型`} title={model ? model.parameters_known === false ? `${model.id} · 使用模型默认参数` : model.id : `选择${noun}模型`} value={model?.id ?? ''} disabled={busy || !catalog?.models.length} onChange={(event) => chooseModel(event.target.value)}>
        <option value="">{catalog ? catalog.configured ? `选择${noun}模型` : `尚未配置${noun}服务` : `加载${noun}模型…`}</option>
        {catalog?.models.map((item) => <option key={item.id}>{item.id}</option>)}
      </select>
      {controls}
      <button type="button" aria-label={`刷新${noun}模型与任务`} title="刷新模型与任务" onClick={() => { forceCatalogRefresh.current = true; setCatalogRevision(value => value + 1); setAttempt(value => value + 1) }}><RefreshCw size={14} /></button>
      <button type="button" className="media-video-submit" aria-label={`生成${noun}`} title={`生成${noun}`} disabled={Boolean(blocked || referenceBlocked || !model || !node.text.trim())} onClick={() => void submit()}>{busy || task && running(task.status) ? <LoaderCircle size={15} className="is-spinning" /> : <ArrowUp size={16} />}</button>
    </div>
    {!isImage && model?.parameters_known === false && <p>使用模型默认画幅、清晰度和时长，暂仅支持文生视频。</p>}
    {catalog && !catalog.configured && <p>{noun}服务尚未配置，请先在服务端配置{noun} API Key。</p>}
    {catalog?.configured && !catalog.models.length && <p>暂无已支持的可用{noun}模型，可刷新重试。</p>}
    {referenceBlocked && catalog?.configured && model && <p>{isImage ? '当前模型尚无图生图支持说明，请切换到文生图。' : '参考素材暂不可用：需先部署公网地址并启用素材访问。'}</p>}
    {!isImage && referenceCount > 0 && (node.generation?.mode ?? 'text') === 'text' && <p>切换到「素材参考」后才会发送连入的参考素材。</p>}
    {task && <div className="media-video-task" role="status"><span>{(isImage ? imageStatusText[task.status] : statusText[task.status]) ?? task.status}{!isImage && running(task.status) ? ` ${task.progress}%` : ''}</span>{!isImage && task.status === 'completed' && task.asset_id && node.asset_id !== task.asset_id && <button type="button" disabled={busy} onClick={() => {
      setBusy(true)
      void api<Asset>(`/assets/${task.asset_id}`).then(onResult).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false))
    }}>使用生成结果</button>}</div>}
    {isImage && task?.status === 'completed' && <div className="media-generated-results" aria-label="生成图片结果">{results.filter((asset) => resultKey.split(',').includes(asset.id)).map((asset, index) => <div className="media-generated-result" key={asset.id}><AssetPreview asset={asset} thumbnail /><button type="button" className="media-generated-use" aria-label={`使用第 ${index + 1} 张生成图片`} title={`使用第 ${index + 1} 张生成图片`} aria-pressed={node.asset_id === asset.id} onClick={() => onResult(asset)}>{node.asset_id === asset.id && <Check size={12} aria-hidden="true" />}</button></div>)}</div>}
    {task?.error && <p role="status">{task.error}</p>}
    <BillingStatus initial={task?.billing} />
    {task?.status === 'download_failed' && <button type="button" disabled={busy} onClick={() => {
      setBusy(true)
      void api<Task>(`${tasksPath}/${task.id}/retry-download`, 'POST').then((next) => { setTask(next); setAttempt((value) => value + 1) }).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false))
    }}>重试保存{noun}</button>}
    {task?.status === 'unknown' && <label className="media-video-unknown"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />已核实上次任务，确认重新提交可能产生新的费用</label>}
    {(catalogError || error) && <p role="alert">{catalogError || error}</p>}
  </div>
}
