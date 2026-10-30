import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { MediaPage } from '../src/pages/media/MediaPage'
import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { defaultGenerationSettings, emptyDocument, type Document } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'
import * as ai from '../src/lib/api'
import { accountAuthTokenKey } from '../src/lib/auth'

const resource = {module:'media',kind:'image_generation',id:'task',scope_id:'project',parent_id:'first'}
const call: ai.AiToolCall = {id:'tool-call',name:'submit_image_generation',label:'提交图片生成',status:'succeeded',started_at:'2026-10-29T00:00:00Z',duration_ms:10,input_summary:'3 项参数',result_summary:'任务已提交',parameter_names:[],proposal_id:null,resource}
afterEach(() => {cleanup();localStorage.clear();sessionStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals()})

function mockChat() {
  localStorage.setItem(accountAuthTokenKey,'synthetic-test-session')
  vi.spyOn(ai,'getProviderModels').mockResolvedValue({provider:'openai',models:[]})
  vi.spyOn(ai,'createAiConversation').mockResolvedValue({id:'conversation',title:'新对话',title_source:'manual',created_at:'',updated_at:''})
  vi.spyOn(ai,'createAiChatRun').mockResolvedValue({id:'run',status:'pending'})
}

it('用户发送前保存画布，工具回执只为第一张建立结果连线，重放不重复创建',async() => {
  mockChat()
  vi.stubGlobal('DOMMatrixReadOnly',class {m22=1})
  vi.spyOn(ai,'getCurrentUser').mockResolvedValue({id:'user',handle:'synthetic',display_name:'合成测试',role:'owner',bio:'',avatar_url:null})
  const generation={...defaultGenerationSettings(),model:'gpt-image-2',image_ratio:'16:9' as const}
  const document:Document={...emptyDocument(),nodes:['first','second'].map((id,index)=>({id,type:'image_generation',name:`0${index+1} 镜头`,text:'夜市开摊',asset_id:null,x:40+index*700,y:80,width:480,height:302,generation}))}
  const api=vi.spyOn(media,'api').mockImplementation((path,method,body) => Promise.resolve(
    path.endsWith('/canvas') ? {version:0,document:method==='PUT'?(body as {document:Document}).document:document}
      : path.endsWith('/image-generations/task') ? {id:'task',node_id:'first',status:'processing',progress:0,error:'',asset_id:null,generation}
      : path.includes('/assets') ? {items:[],total:0}
      : path.includes('image-models') ? {configured:true,references_ready:true,models:[{id:'gpt-image-2',image_edit:true}]}
      : path.includes('/image-generations') ? [] : {id:'project',name:'合成画布',version:0},
  ))
  let handlers!: Parameters<typeof ai.streamAiChatRun>[2]
  vi.spyOn(ai,'streamAiChatRun').mockImplementation((_token,_run,callbacks) => {handlers=callbacks;return new Promise(()=>{})})
  render(<MemoryRouter initialEntries={['/media/projects/project/canvas']}><Routes><Route path="/media/projects/:projectId/canvas" element={<MediaPage/>}/></Routes></MemoryRouter>)
  await screen.findByTestId('rf__node-first')
  fireEvent.change(screen.getAllByRole('textbox',{name:'生图节点名称'})[0]!,{target:{value:'01 新名称'}})
  fireEvent.click(screen.getByRole('button',{name:'镜头搭档'}))
  fireEvent.change(screen.getByRole('textbox',{name:'向镜头搭档提问'}),{target:{value:'生成第一张图片，提交生成'}})
  fireEvent.click(screen.getByRole('button',{name:'发送给镜头搭档'}))
  await waitFor(()=>expect(handlers).toBeDefined())
  const save=api.mock.calls.findIndex(([,method])=>method==='PUT')
  expect(save).toBeGreaterThanOrEqual(0)
  const run=vi.mocked(ai.createAiChatRun)
  expect(api.mock.invocationCallOrder[save]).toBeLessThan(run.mock.invocationCallOrder[0]!)
  await act(async()=>{handlers.onToolCalls?.([call]);await Promise.resolve()})
  expect(await screen.findByText('正在生成图片…')).toBeInTheDocument()
  const draft=JSON.parse(localStorage.getItem('genesis-media-draft:user:project') ?? '{}') as {document:Document}
  expect(draft.document.edges).toHaveLength(1)
  expect(draft.document.edges[0]?.source).toBe('first')
  expect(draft.document.nodes.filter(node=>node.image_result)).toHaveLength(1)
  await act(async()=>{handlers.onToolCalls?.([call]);await Promise.resolve()})
  expect(window.document.querySelectorAll('.react-flow__node-image')).toHaveLength(1)
  expect(api.mock.calls.some(([,method])=>method==='POST')).toBe(false)
})

it('画布保存失败时保留输入，不启动 Agent 或生图请求',async()=>{
  mockChat()
  const save=vi.fn().mockRejectedValue(new Error('画布保存冲突，请先处理'))
  render(<MediaAssistant userId="user" attachmentsAllowed page="canvas" projectId="project" selectedNode={null} canvasActions={{save,getDocument:emptyDocument,attachImageTask:()=>Promise.resolve()}}/>)
  fireEvent.click(screen.getByRole('button',{name:'镜头搭档'}))
  fireEvent.change(screen.getByRole('textbox',{name:'向镜头搭档提问'}),{target:{value:'生成第一张'}})
  fireEvent.click(screen.getByRole('button',{name:'发送给镜头搭档'}))
  expect(await screen.findByText('画布保存冲突，请先处理')).toBeInTheDocument()
  expect(ai.createAiChatRun).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox',{name:'向镜头搭档提问'})).toHaveValue('生成第一张')
})
