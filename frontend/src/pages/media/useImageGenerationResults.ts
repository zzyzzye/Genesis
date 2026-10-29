import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { api, MediaError, type Asset, type Node } from './api'
import type { GenerationTask } from './VideoGeneration'
import type { useCanvas } from './useCanvas'

const running = new Set(['submitting', 'queued', 'processing', 'downloading'])

/** 结果随画布保存；任务查询独立于节点编辑框，恢复时只读取已有任务。 */
export function useImageGenerationResults(projectId: string, canvas: ReturnType<typeof useCanvas>, setAssets: Dispatch<SetStateAction<Record<string, Asset>>>) {
  const { current: documentRef, apply } = canvas
  const created = useRef(new Set<string>())
  const submitting = useRef(new Set<string>())
  const onTask = useCallback((task: GenerationTask, createResults = true) => {
    // 本次 POST 未返回时不查询不存在的任务；刷新后仍可按持久标识恢复。
    if (task.status === 'requesting') submitting.current.add(task.id)
    else submitting.current.delete(task.id)
    const document = documentRef.current
    const source = document.nodes.find(node => node.id === task.node_id)
    const existing = document.nodes.filter(node => node.image_result?.task_id === task.id)
    const error = task.error.slice(0, 2000)
    let nodes = document.nodes.map(node => node.image_result?.task_id === task.id && (node.image_result.status !== task.status || node.image_result.error !== error) ? {
      ...node, image_result: { ...node.image_result, status:task.status, error },
    } : node)
    const edges = [...document.edges]
    if (createResults && !existing.length && !created.current.has(task.id) && source) {
      const settings = task.generation ?? source.generation
      const [w = 1, h = 1] = (settings?.image_ratio || settings?.image_size?.replace('x', ':') || '1:1').split(':').map(Number)
      const height = Number.isFinite(w / h) && w > 0 && h > 0 ? Math.max(80, Math.min(4000, 360 * h / w)) : 360
      for (let index = 0; index < (settings?.count ?? 1); index++) {
        const result: Node = {
          id:crypto.randomUUID(),type:'image',asset_id:null,name:`${source.name || '生图'} · 图片 ${index + 1}`.slice(0,120),text:'',
          x:Math.min(1000000, source.x + source.width + 160),y:Math.max(-1000000, Math.min(1000000, source.y + source.height / 2 + 21 - height / 2)),width:360,height,
          image_result:{ task_id:task.id,index,status:task.status,error },
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
    created.current.add(task.id)
    if (nodes.length !== document.nodes.length || nodes.some((node, index) => node !== document.nodes[index])) apply({ ...document,nodes,edges }, !existing.length)
  }, [documentRef, apply])

  const pending = JSON.stringify(canvas.document.nodes.filter(node => node.image_result && !node.asset_id && !['failed', 'download_failed', 'acknowledged'].includes(node.image_result.status)).map(node => [node.id, node.image_result!.task_id, node.image_result!.status]))
  useEffect(() => {
    const entries = JSON.parse(pending) as [string, string, string][]
    if (!entries.length) return
    let active = true
    const timers: ReturnType<typeof setTimeout>[] = []
    const update = (id: string, task: GenerationTask, assets: Asset[]) => {
      if (!active) return
      if (assets.length) setAssets(previous => ({ ...previous,...Object.fromEntries(assets.map(asset => [asset.id, asset])) }))
      const document = documentRef.current
      const ids = task.asset_ids ?? (task.asset_id ? [task.asset_id] : [])
      const nodes = document.nodes.map(node => {
        const result = node.image_result
        if (!result || result.task_id !== id || node.asset_id) return node
        const asset = ids[result.index]
        const missing = task.status === 'completed' && !asset
        const assetId = task.status === 'completed' && asset ? asset : null
        const status = missing ? 'failed' : task.status
        const error = (missing ? '上游未返回这张图片，请查看生图节点的任务状态。' : task.error).slice(0,2000)
        if (node.asset_id === assetId && result.status === status && result.error === error) return node
        return { ...node,asset_id:assetId,image_result:{ ...result,status,error } }
      })
      if (nodes.some((node, index) => node !== document.nodes[index])) apply({ ...document,nodes }, false)
    }
    const poll = async (id: string) => {
      if (submitting.current.has(id)) {
        timers.push(setTimeout(() => { void poll(id) }, 2000))
        return
      }
      let task: GenerationTask | undefined
      try {
        task = await api<GenerationTask>(`/projects/${projectId}/image-generations/${id}`)
        if (!active) return
        const ids = task.status === 'completed' ? task.asset_ids ?? (task.asset_id ? [task.asset_id] : []) : []
        const assets = await Promise.all(ids.map(assetId => api<Asset>(`/assets/${assetId}`)))
        update(id, task, assets)
        if (active && running.has(task.status)) timers.push(setTimeout(() => { void poll(id) }, 2000))
      } catch (reason) {
        if (!active) return
        if (!task && reason instanceof MediaError && reason.status === 404) {
          update(id, { id,node_id:'',status:'unknown',error:'尚未查到生成任务，请在生图节点刷新状态核实。',progress:0,asset_id:null }, [])
        } else {
          update(id, { id,node_id:'',status:'unknown',error:'图片或任务状态读取失败，正在重试…',progress:0,asset_id:null }, [])
          timers.push(setTimeout(() => { void poll(id) }, 5000))
        }
      }
    }
    for (const id of new Set(entries.map(([, id]) => id))) {
      const starting = entries.some(([, taskId, status]) => taskId === id && ['requesting', 'submitting'].includes(status))
      // 提交响应尚未返回时留出入库时间；刷新恢复仍使用同一任务标识。
      if (starting) timers.push(setTimeout(() => { void poll(id) }, 2000))
      else void poll(id)
    }
    return () => { active = false; timers.forEach(clearTimeout) }
  }, [pending, projectId, documentRef, apply, setAssets])

  return onTask
}
