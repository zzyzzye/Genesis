import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { api, MediaError, type Asset, type Node } from './api'
import type { GenerationTask } from './VideoGeneration'
import type { useCanvas } from './useCanvas'

const running = new Set(['submitting', 'queued', 'processing', 'downloading'])

/** 结果随画布保存；任务查询独立于节点编辑框，恢复时只读取已有任务。 */
export function useGenerationResults(projectId: string, canvas: ReturnType<typeof useCanvas>, setAssets: Dispatch<SetStateAction<Record<string, Asset>>>) {
  const { current: documentRef, apply } = canvas
  const created = useRef(new Set<string>())
  const submitting = useRef(new Set<string>())
  const onTask = useCallback((task: GenerationTask, createResults = true) => {
    const document = documentRef.current
    const source = document.nodes.find(node => node.id === task.node_id)
    const kind = source?.type === 'video' || document.nodes.some(node => node.video_result?.task_id === task.id) ? 'video' : 'image'
    const field = kind === 'video' ? 'video_result' : 'image_result'
    const identity = `${kind}:${task.id}`
    // 本次 POST 未返回时不查询不存在的任务；刷新后仍可按持久标识恢复。
    if (task.status === 'requesting') submitting.current.add(identity)
    else submitting.current.delete(identity)
    const existing = document.nodes.filter(node => node[field]?.task_id === task.id)
    const error = task.error.slice(0, 2000)
    let nodes = document.nodes.map(node => {
      const result = node[field]
      return result?.task_id === task.id && (result.status !== task.status || result.error !== error)
        ? { ...node, [field]: { ...result, status:task.status, error } } : node
    })
    const edges = [...document.edges]
    if (createResults && !existing.length && !created.current.has(identity) && source) {
      const settings = task.generation ?? source.generation
      const ratio = kind === 'video' ? settings?.ratio || '16:9' : settings?.image_ratio || settings?.image_size?.replace('x', ':') || '1:1'
      const [w = 1, h = 1] = ratio.split(':').map(Number)
      const height = Number.isFinite(w / h) && w > 0 && h > 0 ? Math.max(80, Math.min(4000, 360 * h / w)) : 360
      for (let index = 0; index < (kind === 'video' ? 1 : settings?.count ?? 1); index++) {
        const suffix = ` · ${kind === 'video' ? '视频' : '图片'} ${index + 1}`
        const result: Node = {
          id:crypto.randomUUID(),type:kind === 'video' ? 'video_asset' : 'image',asset_id:null,name:`${(source.name || (kind === 'video' ? '生视频' : '生图')).slice(0,120-suffix.length)}${suffix}`,text:'',
          x:Math.min(1000000, source.x + source.width + 160),y:Math.max(-1000000, Math.min(1000000, source.y + source.height / 2 + 21 - height / 2)),width:360,height,
          [field]:{ task_id:task.id,index,status:task.status,error },
        }
        // 为标题与连线留白，不移动既有节点、选中状态或视口。
        while (nodes.some(node => node.type !== 'group' && result.x < node.x + node.width + 32 && result.x + result.width + 32 > node.x && result.y < node.y + node.height + 64 && result.y + result.height + 64 > node.y)) {
          if (result.y + height + 96 > 1000000) { result.x = Math.max(-1000000, result.x - 520); result.y = -1000000 }
          else result.y += height + 96
        }
        nodes = [...nodes, result]
        edges.push({ id:crypto.randomUUID(),source:source.id,target:result.id })
      }
    }
    created.current.add(identity)
    if (nodes.length !== document.nodes.length || nodes.some((node, index) => node !== document.nodes[index])) apply({ ...document,nodes,edges }, !existing.length)
  }, [documentRef, apply])

  const pending = JSON.stringify(canvas.document.nodes.flatMap(node => {
    const result = node.video_result ?? node.image_result
    return result && !node.asset_id && !['failed', 'download_failed', 'acknowledged'].includes(result.status) ? [[node.id, result.task_id, result.status, node.video_result ? 'video' : 'image']] : []
  }))
  useEffect(() => {
    if (canvas.readOnly) return
    const entries = JSON.parse(pending) as [string, string, string, 'image' | 'video'][]
    if (!entries.length) return
    let active = true
    const timers: ReturnType<typeof setTimeout>[] = []
    const update = (kind: 'image' | 'video', id: string, task: GenerationTask, assets: Asset[]) => {
      const field = kind === 'video' ? 'video_result' : 'image_result'
      if (!active) return
      if (assets.length) setAssets(previous => ({ ...previous,...Object.fromEntries(assets.map(asset => [asset.id, asset])) }))
      const document = documentRef.current
      const ids = task.asset_ids ?? (task.asset_id ? [task.asset_id] : [])
      const nodes = document.nodes.map(node => {
        const result = node[field]
        if (!result || result.task_id !== id || node.asset_id) return node
        const asset = ids[result.index]
        const missing = task.status === 'completed' && !asset
        const assetId = task.status === 'completed' && asset ? asset : null
        const status = missing ? 'failed' : task.status
        const error = (missing ? `上游未返回${kind === 'video' ? '视频' : '这张图片'}，请刷新生成任务状态。` : task.error).slice(0,2000)
        if (node.asset_id === assetId && result.status === status && result.error === error) return node
        const stored = assets.find(item => item.id === assetId)
        return { ...node,asset_id:assetId,...(stored ? { name:stored.name.slice(0,120) } : {}),[field]:{ ...result,status,error } }
      })
      if (nodes.some((node, index) => node !== document.nodes[index])) apply({ ...document,nodes }, false)
    }
    const poll = async (kind: 'image' | 'video', id: string) => {
      const noun = kind === 'video' ? '视频' : '图片'
      if (submitting.current.has(`${kind}:${id}`)) {
        timers.push(setTimeout(() => { void poll(kind, id) }, 2000))
        return
      }
      let task: GenerationTask | undefined
      try {
        task = await api<GenerationTask>(`/projects/${projectId}/${kind}-generations/${id}`)
        if (!active) return
        const ids = task.status === 'completed' ? task.asset_ids ?? (task.asset_id ? [task.asset_id] : []) : []
        const assets = await Promise.all(ids.map(assetId => api<Asset>(`/assets/${assetId}`)))
        if (assets.some(asset => asset.kind !== kind)) throw new Error('生成素材类型不匹配')
        update(kind, id, task, assets)
        if (active && running.has(task.status)) timers.push(setTimeout(() => { void poll(kind, id) }, 2000))
      } catch (reason) {
        if (!active) return
        if (!task && reason instanceof MediaError && reason.status === 404) {
          update(kind, id, { id,node_id:'',status:'unknown',error:'尚未查到生成任务，请刷新状态核实。',progress:0,asset_id:null }, [])
        } else {
          update(kind, id, { id,node_id:'',status:'unknown',error:`${noun}或任务状态读取失败，正在重试…`,progress:0,asset_id:null }, [])
          timers.push(setTimeout(() => { void poll(kind, id) }, 5000))
        }
      }
    }
    for (const [id, kind] of new Map(entries.map(([, id, , kind]) => [id, kind]))) {
      const starting = entries.some(([, taskId, status]) => taskId === id && ['requesting', 'submitting'].includes(status))
      // 提交响应尚未返回时留出入库时间；刷新恢复仍使用同一任务标识。
      if (starting) timers.push(setTimeout(() => { void poll(kind, id) }, 2000))
      else void poll(kind, id)
    }
    return () => { active = false; timers.forEach(clearTimeout) }
  }, [pending, projectId, documentRef, apply, setAssets, canvas.readOnly])

  return onTask
}
