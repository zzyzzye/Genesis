import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, LoaderCircle, RefreshCw } from 'lucide-react'
import { api, defaultGenerationSettings, type Asset, type GenerationSettings, type Node } from './api'

export type VideoModel = { id: string; parameters_known?: boolean; ratios: string[]; resolutions: string[]; durations: number[]; images: number; videos: number; audio: boolean }
type ModelList = { configured: boolean; references_ready: boolean; models: VideoModel[] }
type Task = { id: string; node_id: string; status: string; progress: number; error: string; asset_id: string | null }
const running = (status: string) => ['submitting', 'queued', 'processing', 'downloading'].includes(status)
const statusText: Record<string, string> = { submitting:'正在提交', queued:'排队中', processing:'生成中', downloading:'正在保存视频', download_failed:'视频保存失败', completed:'视频已生成', failed:'生成失败', unknown:'创建结果待核实', acknowledged:'已核实旧任务' }

export function VideoGeneration({ projectId, node, onPatch, onSave, onResult, onModelChange, referenceCount = 0, controls }: {
  projectId: string
  node: Node
  onPatch: (patch: Partial<Node>) => void
  onSave: () => Promise<void>
  onResult: (asset: Asset) => void
  onModelChange: (model: VideoModel | null) => void
  referenceCount?: number
  controls?: ReactNode
}) {
  const [catalog, setCatalog] = useState<ModelList | null>(null)
  const [catalogError, setCatalogError] = useState('')
  const [task, setTask] = useState<Task | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const requestId = useRef<string | null>(null)
  const active = useRef(false)
  const model = catalog?.models.find((item) => item.id === node.generation?.model)
  useEffect(() => { onModelChange(model ?? null) }, [model, onModelChange])
  useEffect(() => {
    let current = true
    void api<ModelList>('/video-models').then((data) => {
      if (!data || !Array.isArray(data.models)) throw new Error('视频模型目录格式无效，请重试')
      if (current) { setCatalog(data); setCatalogError('') }
    }).catch((reason: Error) => { if (current) setCatalogError(reason.message) })
    return () => { current = false }
  }, [attempt])
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const tasks = await api<Task[]>(`/projects/${projectId}/video-generations?node_id=${node.id}`)
        if (!current) return
        setTask(tasks[0] ?? null)
        setError('')
        if (tasks[0] && running(tasks[0].status)) timer = setTimeout(() => { void refresh() }, 15000)
      } catch (reason) {
        if (current) { setError((reason as Error).message); timer = setTimeout(() => { void refresh() }, 15000) }
      }
    }
    void refresh()
    return () => { current = false; clearTimeout(timer) }
  }, [projectId, node.id, attempt])

  const chooseModel = (id: string) => {
    const selected = catalog?.models.find((item) => item.id === id)
    if (!selected) return
    const settings = node.generation ?? defaultGenerationSettings()
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
      if (acknowledged) requestId.current = null
      requestId.current ??= crypto.randomUUID()
      const created = await api<Task>(`/projects/${projectId}/video-generations`, 'POST', { request_id:requestId.current, node_id:node.id, acknowledge_unknown:acknowledged })
      setTask(created); requestId.current = null; setAcknowledged(false); setAttempt((value) => value + 1)
    } catch (reason) {
      setError(`${(reason as Error).message}。请先刷新任务状态；再次点击会使用同一请求标识。`)
    } finally { active.current = false; setBusy(false) }
  }, [onSave, projectId, node.id, acknowledged])
  const blocked = busy || Boolean(task && running(task.status)) || task?.status === 'unknown' && !acknowledged
  const referenceBlocked = (node.generation?.mode ?? 'text') !== 'text' && catalog && !catalog.references_ready
  return <div className="media-video-generation">
    <div className="media-video-generation-actions">
      <select aria-label="视频生成模型" title={model ? model.parameters_known === false ? `${model.id} · 使用模型默认参数` : model.id : '选择视频模型'} value={model?.id ?? ''} disabled={busy || !catalog?.models.length} onChange={(event) => chooseModel(event.target.value)}>
        <option value="">{catalog ? catalog.configured ? '选择视频模型' : '尚未配置视频服务' : '加载视频模型…'}</option>
        {catalog?.models.map((item) => <option key={item.id}>{item.id}</option>)}
      </select>
      {controls}
      <button type="button" aria-label="刷新视频模型与任务" title="刷新模型与任务" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={14} /></button>
      <button type="button" className="media-video-submit" aria-label="生成视频" title="生成视频" disabled={Boolean(blocked || referenceBlocked || !model || !node.text.trim())} onClick={() => void submit()}>{busy || task && running(task.status) ? <LoaderCircle size={15} className="is-spinning" /> : <ArrowUp size={16} />}</button>
    </div>
    {model?.parameters_known === false && <p>使用模型默认画幅、清晰度和时长，暂仅支持文生视频。</p>}
    {catalog && !catalog.configured && <p>视频服务尚未配置，请先在服务端配置视频 API Key。</p>}
    {catalog?.configured && !catalog.models.length && <p>暂无已支持的可用视频模型，可刷新重试。</p>}
    {referenceBlocked && <p>参考素材暂不可用：需先部署公网地址并启用素材访问。</p>}
    {referenceCount > 0 && (node.generation?.mode ?? 'text') === 'text' && <p>切换到「素材参考」后才会发送连入的参考素材。</p>}
    {task && <div className="media-video-task" role="status"><span>{statusText[task.status] ?? task.status}{running(task.status) ? ` ${task.progress}%` : ''}</span>{task.status === 'completed' && task.asset_id && node.asset_id !== task.asset_id && <button type="button" disabled={busy} onClick={() => {
      setBusy(true)
      void api<Asset>(`/assets/${task.asset_id}`).then(onResult).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false))
    }}>使用生成结果</button>}</div>}
    {task?.error && <p role="status">{task.error}</p>}
    {task?.status === 'download_failed' && <button type="button" disabled={busy} onClick={() => {
      setBusy(true)
      void api<Task>(`/projects/${projectId}/video-generations/${task.id}/retry-download`, 'POST').then((next) => { setTask(next); setAttempt((value) => value + 1) }).catch((reason: Error) => setError(reason.message)).finally(() => setBusy(false))
    }}>重试保存视频</button>}
    {task?.status === 'unknown' && <label className="media-video-unknown"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />已核实上次任务，确认重新提交可能产生新的费用</label>}
    {(catalogError || error) && <p role="alert">{catalogError || error}</p>}
  </div>
}
