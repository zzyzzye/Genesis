import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageGeneration, type VideoModel } from '../src/pages/media/VideoGeneration'
import { defaultGenerationSettings, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'

const model: VideoModel = { id:'gpt-image-2',ratios:[],resolutions:[],durations:[],images:0,videos:0,audio:false,image_edit:true }
const node: Node = { id:'image-node',type:'image_generation',asset_id:null,text:'雨夜街道',x:0,y:0,width:640,height:402,generation:{...defaultGenerationSettings(),model:model.id,mode:'reference'} }
const props = () => ({projectId:'project',node,onPatch:vi.fn(),onSave:vi.fn().mockResolvedValue(undefined),onResult:vi.fn(),onModelChange:vi.fn()})
const catalog = {configured:true,references_ready:true,models:[model]}
afterEach(()=>vi.restoreAllMocks())

describe('生图节点',()=>{
  it('报价失效后重新报价确认，网络结果未知时才保留原标识',async()=>{
    let quotes = 0, submissions = 0
    vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{
      await Promise.resolve()
      quotes++
      return new Response(JSON.stringify({id:`quote-${quotes}`,mode:'paid',model:model.id,reserved_amount:'0.01'}),{status:201})
    })
    const api=vi.spyOn(media,'api').mockImplementation((path,method)=>{
      if(method==='POST') {
        submissions++
        return submissions===1 ? Promise.reject(new media.MediaError(409,'报价已过期')) : Promise.resolve({id:'task',status:'processing',asset_id:null,error:'',progress:0})
      }
      return Promise.resolve(path==='/image-models'?{...catalog,billing_required:true}:[])
    })
    render(<ImageGeneration {...props()} />)
    await waitFor(()=>expect(screen.getByRole('button',{name:'生成图片'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}))
    fireEvent.click(await screen.findByText('冻结预算并生成'))
    expect(await screen.findByRole('alert')).toHaveTextContent('报价已过期')
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}))
    fireEvent.click(await screen.findByText('冻结预算并生成'))
    await waitFor(()=>expect(submissions).toBe(2))
    expect(quotes).toBe(2)
    expect(api.mock.calls.filter(call=>call[1]==='POST').map(call=>(call[2] as {quote_id:string}).quote_id)).toEqual(['quote-1','quote-2'])
  })

  it('未配置、空目录与目录失败均保留刷新入口',async()=>{
    const api=vi.spyOn(media,'api').mockImplementation(path=>Promise.resolve(path==='/image-models'?{configured:false,references_ready:false,models:[]}:[]))
    render(<ImageGeneration {...props()} />)
    await screen.findByText('图片服务尚未配置，请先在服务端配置图片 API Key。')
    expect(screen.getByRole('button',{name:'生成图片'})).toBeDisabled()
    api.mockImplementation(path=>Promise.resolve(path.startsWith('/image-models')?{...catalog,models:[]}:[]))
    fireEvent.click(screen.getByRole('button',{name:'刷新图片模型与任务'}))
    await screen.findByText('暂无已支持的可用图片模型，可刷新重试。')
    api.mockImplementation(path=>path.startsWith('/image-models')?Promise.reject(new Error('图片模型目录暂不可用')):Promise.resolve([]))
    fireEvent.click(screen.getByRole('button',{name:'刷新图片模型与任务'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('图片模型目录暂不可用')
  })

  it('图片参考直接提交本地任务，连续点击只调用一次且先保存',async()=>{
    let resolve!: (value:unknown)=>void
    const api=vi.spyOn(media,'api').mockImplementation((path,method)=>method==='POST'?new Promise(done=>{resolve=done}):Promise.resolve(path==='/image-models'?catalog:[]))
    const state=props()
    render(<ImageGeneration {...state} />)
    await waitFor(()=>expect(screen.getByRole('button',{name:'生成图片'})).toBeEnabled())
    expect(screen.queryByText(/公网/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}));fireEvent.click(screen.getByRole('button',{name:'生成图片'}))
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/projects/project/image-generations','POST',expect.objectContaining({node_id:node.id})))
    expect(state.onSave).toHaveBeenCalledTimes(1)
    expect(api.mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
    await act(async()=>{resolve({id:'task',status:'processing',asset_id:null,error:'',progress:0});await Promise.resolve()})
  })

  it('新模型仅关闭未经文档确认的编辑，不丢失用户尺寸与数量',async()=>{
    vi.spyOn(media,'api').mockImplementation(path=>Promise.resolve(path==='/image-models'?{...catalog,models:[{...model,id:'new-model',image_edit:false}]}:[]))
    const state=props()
    render(<ImageGeneration {...state} />)
    await screen.findByRole('option',{name:'new-model'})
    fireEvent.change(screen.getByRole('combobox',{name:'图片生成模型'}),{target:{value:'new-model'}})
    expect(state.onPatch).toHaveBeenCalledWith({generation:{...node.generation,model:'new-model',mode:'text'}})
  })

  it('恢复多图结果，缩略图切换预览，不覆盖提示词或重新生成',async()=>{
    const assets=['a','b'].map(id=>({id,name:`${id}.png`,kind:'image' as const,mime_type:'image/png',size:12,in_library:false}))
    vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:test-image')
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{})
    vi.spyOn(media,'fileBlob').mockResolvedValue(new Blob(['image']))
    const api=vi.spyOn(media,'api').mockImplementation(path=>Promise.resolve(path==='/image-models'?catalog:path.startsWith('/assets/')?assets.find(asset=>path===`/assets/${asset.id}`):[{id:'done',status:'completed',asset_id:'a',asset_ids:['a','b'],error:'',progress:0}]))
    const state=props()
    render(<ImageGeneration {...state} />)
    fireEvent.click(await screen.findByRole('button',{name:'使用第 2 张生成图片'}))
    expect(state.onResult).toHaveBeenCalledWith(assets[1])
    expect(api.mock.calls.some(call=>call[1]==='POST')).toBe(false)
    expect(state.onPatch).not.toHaveBeenCalled()
  })

  it('保存失败只重试保存已有图片响应',async()=>{
    let task={id:'saved',status:'download_failed',asset_id:null,error:'保存失败',progress:0}
    const api=vi.spyOn(media,'api').mockImplementation((path,method)=>{
      if(method==='POST'){task={...task,status:'downloading'};return Promise.resolve(task)}
      return Promise.resolve(path==='/image-models'?catalog:[task])
    })
    render(<ImageGeneration {...props()} />)
    fireEvent.click(await screen.findByRole('button',{name:'重试保存图片'}))
    await screen.findByText('正在保存图片')
    expect(api.mock.calls.filter(call=>call[1]==='POST')).toEqual([['/projects/project/image-generations/saved/retry-download','POST']])
  })
})
