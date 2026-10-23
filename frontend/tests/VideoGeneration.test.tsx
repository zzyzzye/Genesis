import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VideoGeneration, type VideoModel } from '../src/pages/media/VideoGeneration'
import { defaultGenerationSettings, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'

const model: VideoModel = { id:'seedance-2.5-720p', ratios:['16:9','9:16'], resolutions:['720p'], durations:[4,5,6,7,8], images:9, videos:3, audio:true }
const node: Node = { id:'video-node', type:'video', asset_id:null, text:'雨夜街道，缓慢推近', x:0,y:0,width:640,height:402, duration_seconds:5, generation:{ ...defaultGenerationSettings(),model:model.id } }
const props = () => ({ projectId:'project',node,onPatch:vi.fn(),onSave:vi.fn().mockResolvedValue(undefined),onResult:vi.fn(),onModelChange:vi.fn() })
afterEach(() => vi.restoreAllMocks())

describe('视频节点生成', () => {
  it('未配置和目录失败都明确提示，可原处刷新', async () => {
    const api = vi.spyOn(media,'api').mockImplementation((path) => path === '/video-models' ? Promise.resolve({configured:false,references_ready:false,models:[]}) : Promise.resolve([]))
    render(<VideoGeneration {...props()} />)
    expect(await screen.findByText('视频服务尚未配置，请先在服务端配置视频 API Key。')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'生成视频'})).toBeDisabled()
    api.mockImplementation((path) => path === '/video-models' ? Promise.reject(new Error('模型目录暂不可用')) : Promise.resolve([]))
    fireEvent.click(screen.getByRole('button',{name:'刷新视频模型与任务'}))
    expect(await screen.findByRole('alert')).toHaveTextContent('模型目录暂不可用')
  })

  it('选择模型时保留兼容参数，修正不支持的清晰度和时长', async () => {
    vi.spyOn(media,'api').mockImplementation((path) => Promise.resolve(path === '/video-models' ? {configured:true,references_ready:true,models:[model]} : []))
    const state = {...props(),node:{...node,duration_seconds:60,generation:{...defaultGenerationSettings(),resolution:'1080P' as const}}}
    render(<VideoGeneration {...state} />)
    await screen.findByRole('option',{name:model.id})
    fireEvent.change(screen.getByRole('combobox',{name:'视频生成模型'}),{target:{value:model.id}})
    expect(state.onPatch).toHaveBeenCalledWith(expect.objectContaining({duration_seconds:4}))
    expect(state.onPatch.mock.calls[0]?.[0] as Partial<Node>).toMatchObject({generation:{model:model.id,resolution:'720P',count:1}})
  })

  it('先保存草稿再提交，连续点击只创建一个任务', async () => {
    let resolve!: (value: unknown) => void
    const api = vi.spyOn(media,'api').mockImplementation((path,method) => method === 'POST' ? new Promise((done) => {resolve=done}) : Promise.resolve(path === '/video-models' ? {configured:true,references_ready:true,models:[model]} : []))
    const state=props()
    render(<VideoGeneration {...state} />)
    await waitFor(() => expect(screen.getByRole('button',{name:'生成视频'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:'生成视频'}))
    fireEvent.click(screen.getByRole('button',{name:'生成视频'}))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/projects/project/video-generations','POST',expect.objectContaining({node_id:node.id})))
    expect(state.onSave).toHaveBeenCalledTimes(1)
    expect(api.mock.calls.filter((call) => call[1] === 'POST')).toHaveLength(1)
    await act(async () => {resolve({id:'task',node_id:node.id,status:'queued',progress:0,error:'',asset_id:null}); await Promise.resolve()})
  })

  it('未知结果必须明确核实；断网重试复用同一请求标识', async () => {
    const requests: unknown[]=[]
    const api=vi.spyOn(media,'api').mockImplementation((path,method,body) => {
      if(method==='POST'){requests.push(body);return Promise.reject(new Error('网络中断'))}
      return Promise.resolve(path==='/video-models'?{configured:true,references_ready:true,models:[model]}:[])
    })
    const state=props()
    render(<VideoGeneration {...state} />)
    await waitFor(() => expect(screen.getByRole('button',{name:'生成视频'})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:'生成视频'}))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button',{name:'生成视频'}))
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[0]).toEqual(requests[1])
    api.mockImplementation((path) => Promise.resolve(path==='/video-models'?{configured:true,references_ready:true,models:[model]}:[{id:'unknown-task',status:'unknown',error:'创建结果未知',progress:0,asset_id:null}]))
    fireEvent.click(screen.getByRole('button',{name:'刷新视频模型与任务'}))
    await screen.findByText('创建结果待核实')
    expect(screen.getByRole('button',{name:'生成视频'})).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button',{name:'生成视频'})).toBeEnabled()
    api.mockImplementation((path,method,body) => {
      const next={id:'new-task',status:'queued',progress:0,error:'',asset_id:null}
      if(method==='POST'){requests.push(body);return Promise.resolve(next)}
      return Promise.resolve(path==='/video-models'?{configured:true,references_ready:true,models:[model]}:[next])
    })
    fireEvent.click(screen.getByRole('button',{name:'生成视频'}))
    await waitFor(() => expect(requests).toHaveLength(3))
    expect((requests[2] as {request_id:string}).request_id).not.toBe((requests[0] as {request_id:string}).request_id)
    expect(requests[2]).toMatchObject({acknowledge_unknown:true})
  })

  it('刷新恢复完成任务，使用结果仅更新预览素材', async () => {
    const asset={id:'result',name:'生成视频.mp4',kind:'video' as const,mime_type:'video/mp4',size:32,in_library:false}
    vi.spyOn(media,'api').mockImplementation((path) => Promise.resolve(path==='/video-models'?{configured:true,references_ready:true,models:[model]}:path==='/assets/result'?asset:[{id:'task',status:'completed',progress:100,error:'',asset_id:asset.id}]))
    const state=props()
    render(<VideoGeneration {...state} />)
    fireEvent.click(await screen.findByRole('button',{name:'使用生成结果'}))
    await waitFor(() => expect(state.onResult).toHaveBeenCalledWith(asset))
    expect(state.onSave).not.toHaveBeenCalled()
  })

  it('参考公网地址未启用时阻止提交', async () => {
    vi.spyOn(media,'api').mockImplementation((path) => Promise.resolve(path==='/video-models'?{configured:true,references_ready:false,models:[model]}:[]))
    render(<VideoGeneration {...props()} node={{...node,generation:{...defaultGenerationSettings(),model:model.id,mode:'reference'}}} />)
    await screen.findByText('参考素材暂不可用：需先部署公网地址并启用素材访问。')
    expect(screen.getByRole('button',{name:'生成视频'})).toBeDisabled()
  })

  it('下载失败只重试保存已有任务，不重新提交生成', async () => {
    let task={id:'saved-task',status:'download_failed',progress:99,error:'保存失败',asset_id:null}
    const api=vi.spyOn(media,'api').mockImplementation((path,method) => {
      if(method==='POST'){task={...task,status:'downloading'};return Promise.resolve(task)}
      return Promise.resolve(path==='/video-models'?{configured:true,references_ready:true,models:[model]}:[task])
    })
    render(<VideoGeneration {...props()} />)
    fireEvent.click(await screen.findByRole('button',{name:'重试保存视频'}))
    await screen.findByText('正在保存视频 99%')
    const posts=api.mock.calls.filter((call) => call[1]==='POST')
    expect(posts).toHaveLength(1)
    expect(posts[0]?.[0]).toBe('/projects/project/video-generations/saved-task/retry-download')
  })
})
