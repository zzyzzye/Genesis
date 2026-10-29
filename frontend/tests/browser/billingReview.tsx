/** 仅供现有 Vite 服务的浏览器验收：所有 API 都使用合成数据，不产生真实费用。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../../styles/base.css'
import '../../styles/shared.css'
import { WalletPage } from '../../src/features/billing/WalletPage'
import { SvgGenerator } from '../../src/pages/toolbox/SvgGenerator'
import { MediaPage } from '../../src/pages/media/MediaPage'
import { AccountProfile } from '../../src/Account'
import type { CurrentUser } from '../../src/lib/api'
import { defaultGenerationSettings, defaultVideoFrame, type Snapshot } from '../../src/pages/media/api'
import type { GenerationTask } from '../../src/pages/media/VideoGeneration'

if (!import.meta.env.DEV || !['127.0.0.1','localhost'].includes(location.hostname)) throw new Error('此验收页仅限本地开发环境')
const parameters = new URLSearchParams(location.search)
const view = parameters.get('view') ?? 'wallet'
const state = parameters.get('state') ?? 'full'
const account: CurrentUser = { id:'11111111-1111-4111-8111-111111111111',handle:'qa-synthetic',display_name:state === 'long' ? '这是用于核验长昵称折行与页面稳定性的合成账户名称' : '合成验收账户',role:parameters.get('role') === 'member' ? 'member' : ['admin','account'].includes(view) ? 'owner' : 'member',bio:'',avatar_url:null }
const token = 'genesis-browser-review-synthetic-token'
localStorage.setItem('genesis-account-token',token)
const project = { id:'22222222-2222-4222-8222-222222222222',name:'账务验收画布',version:1,updated_at:'2026-10-26T06:00:00Z' }
const node = { id:'33333333-3333-4333-8333-333333333333',type:'image_generation',name:'生图节点',text:'月光下的安静森林',x:100,y:100,width:480,height:302,asset_id:null,duration_seconds:5,generation:{ ...defaultGenerationSettings(),model:'gpt-image-2',image_ratio:'16:9' as const,image_resolution:'1K' as const } }
const reviewKey = `genesis-image-review:${state}`
const storedReview = view === 'canvas' ? sessionStorage.getItem(reviewKey) : null
const imageReview = storedReview ? JSON.parse(storedReview) as { snapshot:Snapshot;task:GenerationTask|null;status:string } : { snapshot:{version:1,document:{nodes:[{...node,type:'image_generation' as const}],edges:[],background:'dots' as const,frame:defaultVideoFrame(),viewport:{x:0,y:0,zoom:1}}},task:null,status:'processing' }
const imageAsset = {id:'66666666-6666-4666-8666-666666666666',name:'合成森林.png',kind:'image',mime_type:'image/png',size:32,in_library:false}
addEventListener('genesis-image-review-state',event => { imageReview.status=(event as CustomEvent<string>).detail;sessionStorage.setItem(reviewKey,JSON.stringify(imageReview)) })
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 360"><rect width="480" height="360" rx="24" fill="#18212d"/><path d="M310 68a116 116 0 1 0 70 195 105 105 0 0 1-70-195" fill="#e1c47e"/><path d="M165 215q-12-48 18-61l-7-27 27 19 30-6 24-22 2 36q27 22 9 61z" fill="#f0e7d7"/><path d="M173 211q-23 27-40 2t-20-12" fill="none" stroke="#f0e7d7" stroke-width="13" stroke-linecap="round"/><circle cx="198" cy="170" r="3" fill="#18212d"/><circle cx="237" cy="170" r="3" fill="#18212d"/><path d="m213 182 5 4 5-4" fill="none" stroke="#18212d" stroke-width="3"/><g fill="#e1c47e"><circle cx="102" cy="83" r="3"/><circle cx="383" cy="66" r="3"/><circle cx="396" cy="213" r="2"/><circle cx="340" cy="302" r="3"/></g></svg>'
const bill = { id:'44444444-4444-4444-8444-444444444444',kind:'agent',provider:'openai',model:state === 'long' ? 'gpt-5.6-luna-long-model-identifier-for-narrow-layout-verification' : 'gpt-5.6-luna',mode:'paid',status:'settled',reserved_amount:'0.00800000',charged_amount:'0.00025200',cost_amount:'0.00025200',currency:'CNY',note:state === 'long' ? '账单正在核对，已保留冻结金额。此处为用于检查长说明折行的合成数据，不会产生真实费用。' : '',expires_at:'2099-01-01T00:00:00Z' }
let started = state === 'result', completed = state === 'result', stopped = false
let balance = state === 'empty' ? '0.00000000' : state === 'long' ? '123456789.12345678' : '9.99974800'
let ledger = state === 'empty' ? [] : [{ id:'entry',kind:'settle',amount:'0.00774800',frozen_delta:'-0.00800000',reason:'按上游实账结算，退回未用冻结',created_at:'2026-10-26T06:50:52Z' }]
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status,headers:{ 'Content-Type':'application/json' } })
window.fetch = async (input, init) => {
  await Promise.resolve()
  if (state === 'slow') await new Promise(resolve => setTimeout(resolve,1600))
  const path = new URL(input instanceof Request ? input.url : input instanceof URL ? input.href : input,location.origin).pathname
  const method = init?.method ?? 'GET'
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
  if (path.endsWith('/auth/me')) return reply(account)
  if (state === 'error') return reply({ detail:'合成测试：服务暂不可用，请原处重试' },503)
  if (path.endsWith('/billing/wallet')) return reply({ available:balance,frozen:'0.00000000',currency:'CNY' })
  if (path.endsWith('/billing/entries')) return reply({ items:ledger,total:ledger.length })
  if (path.endsWith('/billing/quotes')) return reply({ ...bill,status:'quoted',kind:body.kind,model:body.kind === 'agent' ? 'gpt-5.6-luna' : 'gpt-image-2' },201)
  if (path.endsWith('/admin/billing/users')) return reply([{ ...account,available:balance,frozen:'0.00000000',currency:'CNY' }])
  if (path.endsWith('/admin/billing/credits')) {
    balance = '19.99974800'; ledger = [{ id:'credit',kind:'credit',amount:'10.00000000',frozen_delta:'0.00000000',reason:'合成入账',created_at:'2026-10-26T07:00:00Z' },...ledger]
    return reply({ available:balance,frozen:'0.00000000',currency:'CNY' },201)
  }
  if (path.endsWith('/admin/billing/policies')) return reply(method === 'GET' ? [] : { id:'policy' },method === 'GET' ? 200 : 201)
  if (path.endsWith('/billing/operations')) return reply({ items:state === 'empty' ? [] : [bill,{ ...bill,id:'pending',kind:'image',model:'gpt-image-2',status:'pending' },{ ...bill,id:'free',provider:'mimo',mode:'free',model:'mimo-v2.6-flash',charged_amount:'0.00000000' }],total:state === 'empty' ? 0 : 3 })
  if (path.includes('/billing/operations/')) return reply({ ...bill,calls:[{ request_id:'synthetic-gateway-request',status:'settled',amount:'0.00025200',details:{ prompt_tokens:4391,completion_tokens:7,cache_tokens:4224,matched_tier:'short',billing_formula:{ final_quota:126,effective_group_ratio:0.2 },response_model:{ upstream_model:'gpt-5.6-terra' } } }] })
  if (path.endsWith('/ai/chat/runs') && method === 'POST') { started = true; completed = false; stopped = false; return reply({ id:'55555555-5555-4555-8555-555555555555',status:'pending' },202) }
  if (path.includes('/ai/chat/runs/') && method === 'DELETE') { stopped = true; return new Response(null,{ status:204 }) }
  if (path.includes('/ai/chat/runs/') && path.endsWith('/stream')) {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({ start(controller) {
      const emit = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      const runId = '55555555-5555-4555-8555-555555555555'
      const messageId = `${runId}:assistant`
      emit({ type:'RUN_STARTED',threadId:runId,runId })
      emit({ type:'MESSAGES_SNAPSHOT',messages:[{ id:messageId,role:'assistant',content:'' }] })
      emit({ type:'TEXT_MESSAGE_START',messageId,role:'assistant' })
      setTimeout(() => { emit({ type:'TEXT_MESSAGE_CONTENT',messageId,delta:svg.slice(0,300) }) },300)
      setTimeout(() => {
        completed = !stopped
        if (stopped) emit({ type:'RUN_ERROR',message:'生成已由用户停止。' })
        else {
          emit({ type:'TEXT_MESSAGE_CONTENT',messageId,delta:svg.slice(300) })
          emit({ type:'TEXT_MESSAGE_END',messageId })
          emit({ type:'RUN_FINISHED',threadId:runId,runId })
        }
        controller.close()
      },2000)
    } })
    return new Response(stream,{ headers:{ 'Content-Type':'text/event-stream' } })
  }
  if (path.includes('/ai/chat/runs/')) return reply({ id:'55555555-5555-4555-8555-555555555555',status:stopped ? 'failed' : completed ? 'completed' : 'running',content:completed ? svg : '',error:stopped ? '生成已由用户停止。' : null,sequence:2 })
  if (path.endsWith('/media/projects')) return reply([project])
  if (path.endsWith(`/media/projects/${project.id}`)) return reply(project)
  if (path.endsWith('/canvas')) {
    if(method === 'PUT') { imageReview.snapshot={version:imageReview.snapshot.version+1,document:body.document as Snapshot['document']};sessionStorage.setItem(reviewKey,JSON.stringify(imageReview)) }
    return reply(imageReview.snapshot)
  }
  if (path.endsWith('/assets')) return reply({ items:imageReview.status === 'completed' ? [imageAsset] : [],total:imageReview.status === 'completed' ? 1 : 0 })
  if (path.endsWith(`/assets/${imageAsset.id}`)) return reply(imageAsset)
  if (path.includes(`/assets/${imageAsset.id}/`)) return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jbcQAAAAASUVORK5CYII='),character=>character.charCodeAt(0)),{headers:{'Content-Type':'image/png'}})
  if (path.endsWith('/video-generations')) return reply([])
  if (path.endsWith('/image-models')) return reply({ configured:true,references_ready:true,billing_required:true,models:[{ id:'gpt-image-2',image_edit:true }] })
  const imageTask = () => imageReview.task ? {...imageReview.task,status:imageReview.status,error:imageReview.status === 'failed' ? '合成错误：模型暂不可用' : '',asset_id:imageReview.status === 'completed' ? imageAsset.id : null,asset_ids:imageReview.status === 'completed' ? [imageAsset.id] : []} : null
  if (path.endsWith('/image-generations')) {
    if(method === 'POST') {
      imageReview.task={id:body.request_id as string,node_id:node.id,status:'processing',progress:0,error:'',asset_id:null}
      sessionStorage.setItem(reviewKey,JSON.stringify(imageReview))
      await new Promise(resolve=>setTimeout(resolve,800))
    }
    return reply(method === 'GET' ? imageReview.task ? [imageTask()] : [] : imageTask(),method === 'GET' ? 200 : 202)
  }
  if (path.includes('/image-generations/')) return imageReview.task ? reply(imageTask()) : reply({detail:'合成任务不存在'},404)
  if (path.includes('/llm/providers/')) {
    if (state === 'model-error') return reply({ detail:'模型目录请求失败，请稍后重试' },502)
    const provider = path.split('/').at(-2)
    return reply({ provider,models:state === 'model-empty' ? [] : [{ id:provider === 'mimo' ? 'mimo-v2.6-flash' : 'gpt-5.6-luna',name:provider === 'mimo' ? 'MiMo V2.6 Flash' : 'GPT 5.6 Luna',billing_mode:provider === 'mimo' ? 'free' : 'paid',context_window:272000 }] })
  }
  if (path.endsWith('/ai/chat/conversations')) return reply(method === 'POST' ? { id:'conversation',title:'新对话',title_source:'manual' } : [])
  return reply({ detail:'合成验收未配置此响应' },404)
}
if (started) { sessionStorage.setItem(`genesis-svg-run:${account.id}`,'55555555-5555-4555-8555-555555555555'); sessionStorage.setItem(`genesis-svg-prompt:${account.id}`,'画一只月光下的小猫') }
else sessionStorage.removeItem(`genesis-svg-run:${account.id}`)
addEventListener('pagehide',() => { if(localStorage.getItem('genesis-account-token') === token) localStorage.removeItem('genesis-account-token') },{ once:true })
const initial = view === 'svg' ? '/toolbox/svg' : view === 'canvas' ? `/media/projects/${project.id}/canvas` : view === 'admin' ? '/account/billing' : view === 'account' ? '/account' : '/account/wallet'
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[initial]}><Routes>
  <Route path="/account/wallet" element={<WalletPage />} /><Route path="/account/billing" element={<WalletPage admin />} />
  <Route path="/account" element={<AccountProfile user={account} feedback={null} busy={false} onLogout={() => undefined} onSave={() => undefined} />} />
  <Route path="/toolbox/svg" element={<SvgGenerator />} /><Route path="/media/projects/:projectId/canvas" element={<MediaPage />} />
</Routes></MemoryRouter>)
