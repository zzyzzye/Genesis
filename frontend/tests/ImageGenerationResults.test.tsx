import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useCanvas } from '../src/pages/media/useCanvas'
import { useGenerationResults } from '../src/pages/media/useGenerationResults'
import { defaultGenerationSettings, emptyDocument, type Asset, type Document, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import type { GenerationTask } from '../src/pages/media/VideoGeneration'

const source: Node = {id:'source',type:'image_generation',asset_id:null,name:'镜头一',text:'夜市',x:0,y:0,width:480,height:302,generation:{...defaultGenerationSettings(),count:2,image_ratio:'16:9'}}
const task: GenerationTask = {id:'task',node_id:source.id,status:'processing',progress:0,error:'',asset_id:null}
const assets: Asset[] = ['a','b'].map(id => ({id,name:`${id}.png`,kind:'image',mime_type:'image/png',size:4,in_library:false}))
afterEach(() => { cleanup();localStorage.clear();vi.useRealTimers();vi.restoreAllMocks() })

function setup(document: Document = {...emptyDocument(),nodes:[source]}, availableAssets = assets) {
  const notice = vi.fn()
  let currentTask = task
  const api = vi.spyOn(media,'api').mockImplementation((path,method,body) => {
    if (path.endsWith('/canvas')) return Promise.resolve(method === 'PUT' ? {version:1,document:(body as {document:Document}).document} : {version:0,document})
    if (path.startsWith('/assets/')) return Promise.resolve(availableAssets.find(asset => path===`/assets/${asset.id}`))
    return Promise.resolve(currentTask)
  })
  const view = renderHook(() => {
    const canvas = useCanvas('project','user')
    const [loaded,setAssets] = useState<Record<string,Asset>>({})
    const onTask = useGenerationResults('project',canvas,setAssets,notice)
    return {canvas,onTask,loaded}
  })
  return {view,api,notice,setTask:(next:GenerationTask) => {currentTask=next}}
}

describe('画布图片生成结果',() => {
  it('提交和失败各提醒一次，打开旧任务不重播提醒', async () => {
    const {view,notice} = setup()
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    act(() => {
      view.result.current.onTask(task)
      view.result.current.onTask({...task,status:'queued'})
    })
    expect(notice).toHaveBeenCalledTimes(1)
    expect(notice).toHaveBeenLastCalledWith('图片生成已提交')
    act(() => {
      view.result.current.onTask({...task,status:'failed',error:'上游拒绝'})
      view.result.current.onTask({...task,status:'failed',error:'上游拒绝'},false)
      view.result.current.onTask({...task,id:'old-task',status:'failed',error:'旧任务'},false)
    })
    expect(notice).toHaveBeenCalledTimes(2)
    expect(notice).toHaveBeenLastCalledWith('图片生成失败：上游拒绝')
  })
  it('Agent 回执按任务保存的参数建结果，不受提交后编辑的张数和画幅影响',async()=>{
    const {view}=setup()
    await waitFor(()=>expect(view.result.current.canvas.ready).toBe(true))
    act(()=>view.result.current.onTask({...task,generation:{...source.generation!,count:1,image_ratio:'9:16'}}))
    const results=view.result.current.canvas.document.nodes.filter(node=>node.image_result)
    expect(results).toHaveLength(1)
    expect(results[0]?.height).toBe(640)
  })

  it('提交响应较慢时保持加载，不把尚未入库的任务误报为不存在',async() => {
    const {view,api} = setup()
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    vi.useFakeTimers()
    act(() => view.result.current.onTask({...task,status:'requesting'}))
    await act(async() => { await vi.advanceTimersByTimeAsync(4500) })
    expect(api.mock.calls.some(([path])=>path.includes('/image-generations/'))).toBe(false)
    expect(view.result.current.canvas.document.nodes.find(node=>node.image_result)?.image_result?.status).toBe('requesting')
    await act(async() => { view.result.current.onTask(task);await Promise.resolve() })
    expect(api).toHaveBeenCalledWith('/projects/project/image-generations/task')
  })

  it('提交前建立多图占位和连线，避开已有节点且不改变视口；重复通知不增建',async() => {
    const obstacle = {...source,id:'obstacle',type:'image' as const,x:640,y:0,width:360,height:203}
    const {view} = setup({...emptyDocument(),nodes:[source,obstacle]})
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    act(() => view.result.current.onTask({...task,status:'submitting'}))
    const created = view.result.current.canvas.document.nodes.filter(node => node.image_result)
    expect(created).toHaveLength(2)
    expect(created.map(node=>node.image_result?.index)).toEqual([0,1])
    expect(created.every(node => node.y > obstacle.y+obstacle.height && node.image_result?.status==='submitting' && !node.asset_id)).toBe(true)
    expect(view.result.current.canvas.document.edges.map(edge=>[edge.source,edge.target])).toEqual(created.map(node=>[source.id,node.id]))
    expect(view.result.current.canvas.document.viewport).toEqual(emptyDocument().viewport)
    act(() => view.result.current.onTask({...task,status:'submitting'}))
    expect(view.result.current.canvas.document.nodes).toHaveLength(4)
  })

  it('任务完成时原地填充所有图片，关闭编辑框也不影响查询，刷新恢复不提交生成',async() => {
    const result:Node = {...source,id:'result',type:'image',asset_id:null,image_result:{task_id:task.id,index:1,status:'processing',error:''}}
    const {view,api} = setup({...emptyDocument(),nodes:[source,result],edges:[{id:'edge',source:source.id,target:result.id}]})
    // 恢复时只存在画布 hook，没有挂载任何生成编辑框。
    api.mockImplementation(path=>Promise.resolve(path.endsWith('/canvas')?{version:0,document:{...emptyDocument(),nodes:[source,result],edges:[{id:'edge',source:source.id,target:result.id}]}}:path.startsWith('/assets/')?assets.find(asset=>path===`/assets/${asset.id}`):{...task,status:'completed',asset_ids:['a','b']}))
    await waitFor(() => expect(view.result.current.canvas.document.nodes.find(node=>node.id==='result')?.asset_id).toBe('b'))
    expect(view.result.current.loaded.b).toEqual(assets[1])
    expect(view.result.current.canvas.document.edges).toEqual([{id:'edge',source:source.id,target:'result'}])
    expect(api.mock.calls.some(([,method])=>method==='POST')).toBe(false)
  })

  it('失败保留结果节点并停止加载，重新提交使用新结果节点，不复活已删除节点',async() => {
    const {view,api} = setup()
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    act(() => view.result.current.onTask({...task,status:'failed',error:'参数不支持'}))
    expect(view.result.current.canvas.document.nodes.filter(node=>node.image_result).every(node=>node.image_result?.status==='failed')).toBe(true)
    expect(api.mock.calls.some(([path])=>path.includes('/image-generations/'))).toBe(false)
    act(() => view.result.current.canvas.apply({...view.result.current.canvas.current.current,nodes:[source],edges:[]}))
    act(() => view.result.current.onTask({...task,status:'failed',error:'参数不支持'}))
    expect(view.result.current.canvas.document.nodes).toHaveLength(1)
    act(() => view.result.current.onTask({...task,id:'new-task',status:'submitting'}))
    expect(view.result.current.canvas.document.nodes.filter(node=>node.image_result?.task_id==='new-task')).toHaveLength(2)
  })

  it('多图响应少于请求数量时，其余节点显示失败而不永久加载',async() => {
    const {view,setTask,notice} = setup()
    setTask({...task,status:'completed',asset_ids:['a']})
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    act(() => view.result.current.onTask(task))
    await waitFor(() => expect(view.result.current.canvas.document.nodes.find(node=>node.image_result?.index===0)?.asset_id).toBe('a'))
    const missing = view.result.current.canvas.document.nodes.find(node=>node.image_result?.index===1)?.image_result
    expect(missing?.status).toBe('failed')
    expect(missing?.error).toContain('未返回')
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('未返回全部结果'))
    expect(notice).not.toHaveBeenCalledWith('图片生成完成，结果已放入画布')
  })

  it('图片读取失败与任务不存在分别提示，读取失败不再发起生成',async() => {
    const {view,api} = setup()
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    api.mockImplementation(path => path.startsWith('/assets/')
      ? Promise.reject(new media.MediaError(404,'图片不可用'))
      : Promise.resolve({...task,status:'completed',asset_ids:['a','b']}))
    act(() => view.result.current.onTask(task))
    await waitFor(() => expect(view.result.current.canvas.document.nodes.find(node=>node.image_result)?.image_result?.error).toContain('读取失败'))
    expect(view.result.current.canvas.document.nodes.find(node=>node.image_result)?.image_result?.error).not.toContain('未查到生成任务')
    expect(api.mock.calls.some(([,method])=>method==='POST')).toBe(false)
  })
})

describe('画布视频与图片共用结果流程', () => {
  const videoSource: Node = { ...source, type:'video', generation:{ ...defaultGenerationSettings(), ratio:'9:16', count:4 } }
  const videoAsset: Asset = { id:'video-asset', name:'夜市 · 视频 1', kind:'video', mime_type:'video/mp4', size:32, in_library:false }

  it.each(['video', 'image'] as const)('同一 %s 生成节点连续完成两次任务，保留每批成品和一对多连线', async kind => {
    const origin = kind === 'video' ? videoSource : source
    const count = kind === 'video' ? 1 : 2
    const results: Asset[] = Array.from({length:count * 2}, (_, index) => ({
      id:`${kind}-${index}`, name:`成品 ${index + 1}`, kind, mime_type:kind === 'video' ? 'video/mp4' : 'image/png', size:32, in_library:false,
    }))
    const first = {...task, id:'first-task', status:'completed', asset_id:results[0]!.id, asset_ids:results.slice(0,count).map(asset => asset.id)}
    const second = {...task, id:'second-task', status:'completed', asset_id:results[count]!.id, asset_ids:results.slice(count).map(asset => asset.id)}
    const {view,api} = setup({...emptyDocument(),nodes:[origin]}, results)
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    api.mockImplementation((path,method,body) => Promise.resolve(
      path.endsWith('/canvas') && method === 'PUT' ? {version:1,document:(body as {document:Document}).document}
        : path.startsWith('/assets/') ? results.find(asset => path === `/assets/${asset.id}`)
          : path.endsWith('/first-task') ? first : second,
    ))
    act(() => view.result.current.onTask({...first,status:'processing',asset_id:null,asset_ids:[]}))
    await waitFor(() => expect(view.result.current.canvas.document.nodes.filter(node => node.asset_id)).toHaveLength(count))
    const previous = view.result.current.canvas.document.nodes.filter(node => node.asset_id)
    act(() => view.result.current.onTask({...second,status:'processing',asset_id:null,asset_ids:[]}))
    await waitFor(() => expect(view.result.current.canvas.document.nodes.filter(node => node.asset_id)).toHaveLength(count * 2))
    act(() => { view.result.current.onTask(first); view.result.current.onTask(second) })
    const document = view.result.current.canvas.document
    expect(document.nodes).toHaveLength(1 + count * 2)
    expect(document.nodes.filter(node => previous.some(old => old.id === node.id))).toEqual(previous)
    expect(document.nodes.filter(node => node.asset_id).map(node => node.asset_id)).toEqual(results.map(asset => asset.id))
    expect(document.edges).toHaveLength(count * 2)
    expect(document.edges.every(edge => edge.source === origin.id)).toBe(true)
    expect(new Set(document.edges.map(edge => edge.target)).size).toBe(count * 2)
    expect(document.nodes[0]).toEqual(origin)
    await act(async () => { await view.result.current.canvas.save() })
    expect(api).toHaveBeenCalledWith('/projects/project/canvas','PUT',expect.objectContaining({document}))
    expect(api.mock.calls.some(([,method]) => method === 'POST')).toBe(false)
  })

  it('提交时自动创建一个视频成品占位与连线，按视频画幅定高且不覆盖草稿预览', async () => {
    const { view } = setup({ ...emptyDocument(), nodes:[videoSource] }, [videoAsset])
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    act(() => view.result.current.onTask({ ...task, status:'requesting' }))
    const results = view.result.current.canvas.document.nodes.filter(node => node.video_result)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ type:'video_asset', asset_id:null, width:360, height:640, video_result:{status:'requesting',index:0} })
    expect(view.result.current.canvas.document.edges).toEqual([expect.objectContaining({ source:source.id, target:results[0]?.id })])
    expect(view.result.current.canvas.document.nodes[0]).toEqual(videoSource)
    expect(view.result.current.canvas.document.viewport).toEqual(emptyDocument().viewport)
  })

  it('关闭编辑器或重开画布仍自动填充视频，不再 POST、不重复结果或连线', async () => {
    const result: Node = { ...videoSource, id:'video-result', type:'video_asset', video_result:{task_id:task.id,index:0,status:'processing',error:''} }
    const edge = { id:'video-edge', source:source.id, target:result.id }
    const { view, api, setTask } = setup({ ...emptyDocument(), nodes:[videoSource,result], edges:[edge] }, [videoAsset])
    setTask({ ...task, status:'completed', asset_id:videoAsset.id })
    await waitFor(() => expect(view.result.current.canvas.document.nodes.find(node => node.id === result.id)?.asset_id).toBe(videoAsset.id))
    expect(api).toHaveBeenCalledWith('/projects/project/video-generations/task')
    expect(view.result.current.loaded[videoAsset.id]).toEqual(videoAsset)
    expect(view.result.current.canvas.document.nodes.find(node => node.id === result.id)?.name).toBe(videoAsset.name)
    act(() => view.result.current.onTask({ ...task, status:'completed', asset_id:videoAsset.id }))
    expect(view.result.current.canvas.document.nodes).toHaveLength(2)
    expect(view.result.current.canvas.document.edges).toEqual([edge])
    expect(api.mock.calls.some(([,method]) => method === 'POST')).toBe(false)
  })

  it('视频失败和重试保存复用占位，删除后同一任务通知不会复活节点', async () => {
    const { view } = setup({ ...emptyDocument(), nodes:[videoSource] }, [videoAsset])
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    act(() => view.result.current.onTask({ ...task, status:'download_failed', error:'保存失败' }))
    expect(view.result.current.canvas.document.nodes.find(node => node.video_result)?.video_result?.status).toBe('download_failed')
    act(() => view.result.current.onTask({ ...task, status:'downloading' }))
    expect(view.result.current.canvas.document.nodes.filter(node => node.video_result)).toHaveLength(1)
    act(() => view.result.current.canvas.apply({ ...emptyDocument(), nodes:[videoSource] }))
    act(() => view.result.current.onTask(task))
    expect(view.result.current.canvas.document.nodes).toHaveLength(1)
    act(() => view.result.current.onTask({ ...task, id:'next-video-task' }))
    expect(view.result.current.canvas.document.nodes.filter(node => node.video_result)).toHaveLength(1)
  })
})
