import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { useCanvas } from '../src/pages/media/useCanvas'
import { useImageGenerationResults } from '../src/pages/media/useImageGenerationResults'
import { defaultGenerationSettings, emptyDocument, type Asset, type Document, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import type { GenerationTask } from '../src/pages/media/VideoGeneration'

const source: Node = {id:'source',type:'image_generation',asset_id:null,name:'镜头一',text:'夜市',x:0,y:0,width:480,height:302,generation:{...defaultGenerationSettings(),count:2,image_ratio:'16:9'}}
const task: GenerationTask = {id:'task',node_id:source.id,status:'processing',progress:0,error:'',asset_id:null}
const assets: Asset[] = ['a','b'].map(id => ({id,name:`${id}.png`,kind:'image',mime_type:'image/png',size:4,in_library:false}))
afterEach(() => { cleanup();localStorage.clear();vi.useRealTimers();vi.restoreAllMocks() })

function setup(document: Document = {...emptyDocument(),nodes:[source]}) {
  let currentTask = task
  const api = vi.spyOn(media,'api').mockImplementation((path,method,body) => {
    if (path.endsWith('/canvas')) return Promise.resolve(method === 'PUT' ? {version:1,document:(body as {document:Document}).document} : {version:0,document})
    if (path.startsWith('/assets/')) return Promise.resolve(assets.find(asset => path===`/assets/${asset.id}`))
    return Promise.resolve(currentTask)
  })
  const view = renderHook(() => {
    const canvas = useCanvas('project','user')
    const [loaded,setAssets] = useState<Record<string,Asset>>({})
    const onTask = useImageGenerationResults('project',canvas,setAssets)
    return {canvas,onTask,loaded}
  })
  return {view,api,setTask:(next:GenerationTask) => {currentTask=next}}
}

describe('画布图片生成结果',() => {
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
    const {view,setTask} = setup()
    setTask({...task,status:'completed',asset_ids:['a']})
    await waitFor(() => expect(view.result.current.canvas.ready).toBe(true))
    act(() => view.result.current.onTask(task))
    await waitFor(() => expect(view.result.current.canvas.document.nodes.find(node=>node.image_result?.index===0)?.asset_id).toBe('a'))
    const missing = view.result.current.canvas.document.nodes.find(node=>node.image_result?.index===1)?.image_result
    expect(missing?.status).toBe('failed')
    expect(missing?.error).toContain('未返回')
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
