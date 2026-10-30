import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageGeneration, type VideoModel } from '../src/pages/media/VideoGeneration'
import { defaultGenerationSettings, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'

const model: VideoModel = { id:'gpt-image-2',ratios:[],resolutions:[],durations:[],images:0,videos:0,audio:false,image_edit:true }
const node: Node = { id:'image-node',type:'image_generation',asset_id:null,text:'雨夜街道',x:0,y:0,width:640,height:402,generation:{...defaultGenerationSettings(),model:model.id,mode:'reference'} }
const props = () => ({projectId:'project',node,referenceCount:1,onPatch:vi.fn(),onSave:vi.fn().mockResolvedValue(undefined),onResult:vi.fn(),onModelChange:vi.fn()})
const catalog = {configured:true,references_ready:true,models:[model]}
afterEach(()=>vi.restoreAllMocks())

describe('生图节点',()=>{
  it('服务端明确拒绝时只展示原错误，不拼接创建结果未知的重试提示',async()=>{
    const onTask=vi.fn()
    vi.spyOn(media,'api').mockImplementation((path,method)=>method==='POST'
      ? Promise.reject(new media.MediaError(503,'图片服务暂不可用，请稍后重试'))
      : Promise.resolve(path==='/image-models'?catalog:[]))
    render(<ImageGeneration {...props()} onTask={onTask} />)
    await waitFor(()=>expect(screen.getByRole('button',{name:'生成图片'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('图片服务暂不可用，请稍后重试')
    expect(screen.getByRole('alert')).not.toHaveTextContent('请先刷新任务状态')
    expect(onTask).toHaveBeenLastCalledWith(expect.objectContaining({status:'failed',error:'图片服务暂不可用，请稍后重试'}))
  })
  it('付费图片直接提交，参数失败后重新提交不需要报价或预算确认',async()=>{
    let submissions = 0
    const fetch = vi.spyOn(globalThis,'fetch')
    const api=vi.spyOn(media,'api').mockImplementation((path,method)=>{
      if(method==='POST') {
        submissions++
        return submissions===1 ? Promise.reject(new media.MediaError(409,'参数已变化')) : Promise.resolve({id:'task',status:'processing',asset_id:null,error:'',progress:0})
      }
      return Promise.resolve(path==='/image-models'?{...catalog,billing_required:true}:[])
    })
    render(<ImageGeneration {...props()} />)
    await waitFor(()=>expect(screen.getByRole('button',{name:'生成图片'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('参数已变化')
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}))
    await waitFor(()=>expect(submissions).toBe(2))
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.mock.calls.filter(call=>call[1]==='POST').every(call=>!('quote_id' in (call[2] as object)))).toBe(true)
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
    const onTask=vi.fn()
    render(<ImageGeneration {...state} onTask={onTask} />)
    await waitFor(()=>expect(screen.getByRole('button',{name:'生成图片'})).toBeEnabled())
    expect(screen.queryByText(/公网/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'生成图片'}));fireEvent.click(screen.getByRole('button',{name:'生成图片'}))
    await waitFor(()=>expect(api).toHaveBeenCalledWith('/projects/project/image-generations','POST',expect.objectContaining({node_id:node.id})))
    expect(onTask).toHaveBeenCalledWith(expect.objectContaining({node_id:node.id,status:'requesting',asset_id:null}))
    expect(state.onSave).toHaveBeenCalledTimes(1)
    expect(api.mock.calls.filter(call=>call[1]==='POST')).toHaveLength(1)
    await act(async()=>{resolve({id:'task',status:'processing',asset_id:null,error:'',progress:0});await Promise.resolve()})
  })

  it('不支持图生图的模型保留参考并阻止生成，移除参考后自动恢复文生图',async()=>{
    vi.spyOn(media,'api').mockImplementation(path=>Promise.resolve(path==='/image-models'?{...catalog,models:[{...model,id:'new-model',image_edit:false}]}:[]))
    const state=props()
    const view=render(<ImageGeneration {...state} />)
    await screen.findByRole('option',{name:'new-model'})
    fireEvent.change(screen.getByRole('combobox',{name:'图片生成模型'}),{target:{value:'new-model'}})
    expect(state.onPatch).toHaveBeenCalledWith({generation:{...node.generation,model:'new-model'}})
    view.rerender(<ImageGeneration {...state} node={{...node,generation:{...node.generation!,model:'new-model'}}} />)
    expect(screen.getByLabelText('图片生成模式')).toHaveTextContent('图生图')
    expect(screen.getByRole('button',{name:'生成图片'})).toBeDisabled()
    expect(screen.getByText(/选择支持图生图的模型，或移除图片参考/)).toBeInTheDocument()
    view.rerender(<ImageGeneration {...state} node={{...node,generation:{...node.generation!,model:'new-model'}}} referenceCount={0} />)
    expect(screen.getByLabelText('图片生成模式')).toHaveTextContent('文生图')
    expect(screen.getByRole('button',{name:'生成图片'})).toBeEnabled()
  })

  it('按当前图片参考自动显示模式，未就绪参考阻止提交而不是退回文生图',async()=>{
    const api=vi.spyOn(media,'api').mockImplementation(path=>Promise.resolve(path==='/image-models'?catalog:[]))
    const state=props()
    const view=render(<ImageGeneration {...state} node={{...node,generation:{...node.generation!,mode:'text'}}} referencesPending />)
    await screen.findByRole('option',{name:model.id})
    expect(screen.getByLabelText('图片生成模式')).toHaveTextContent('图生图')
    expect(screen.getByRole('button',{name:'生成图片'})).toBeDisabled()
    expect(screen.getByText(/参考图片尚未就绪/)).toBeInTheDocument()
    view.rerender(<ImageGeneration {...state} />)
    expect(screen.getByRole('button',{name:'生成图片'})).toBeEnabled()
    view.rerender(<ImageGeneration {...state} referenceCount={0} />)
    expect(screen.getByLabelText('图片生成模式')).toHaveTextContent('文生图')
    expect(screen.queryByRole('combobox',{name:'参考模式'})).not.toBeInTheDocument()
    expect(api.mock.calls.some(call=>call[1]==='POST')).toBe(false)
  })

  it('恢复多图任务交给画布显示结果，编辑面板不重复读取或展示缩略图',async()=>{
    const task={id:'done',status:'completed',asset_id:'a',asset_ids:['a','b'],error:'',progress:0}
    const api=vi.spyOn(media,'api').mockImplementation(path=>Promise.resolve(path==='/image-models'?catalog:[task]))
    const state=props()
    const onTask=vi.fn()
    render(<ImageGeneration {...state} onTask={onTask} />)
    await waitFor(()=>expect(onTask).toHaveBeenCalledWith(task,false))
    expect(screen.queryByLabelText('生成图片结果')).not.toBeInTheDocument()
    expect(screen.queryByText('图片已生成')).not.toBeInTheDocument()
    expect(api.mock.calls.some(([path])=>path.startsWith('/assets/'))).toBe(false)
    expect(state.onResult).not.toHaveBeenCalled()
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
