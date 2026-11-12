/** 仅在隔离浏览器中验收全站后台，不请求真实管理数据。 */
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AdminPage } from '../../src/pages/admin/AdminPage'
import '../../styles/base.css'
import '../../styles/shared.css'

if(!import.meta.env.DEV || !['localhost','127.0.0.1'].includes(location.hostname))throw new Error('仅限本地验收')
const params=new URLSearchParams(location.search)
const state=params.get('state')??'full'
localStorage.setItem('genesis-account-token','synthetic-admin-review')
const now=Math.floor(Date.now()/1000)
const account={id:'11111111-1111-4111-8111-111111111111',handle:'synthetic',display_name:'合成测试账户',role:state==='member'?'member':'owner',bio:'',avatar_url:null,created_at:new Date().toISOString(),available:'19.00000000'}
const overview={users:24,posts:16,projects:38,assets:240,tasks_24h:57,statuses:{failed:3,running:2},review_orders:1,businesses:[{business:'blog',tasks:45},{business:'media',tasks:112},{business:'toolbox',tasks:32}]}
const monitoring={details:{cores:Array.from({length:8},(_,i)=>({name:String(i),usage:12+i*3})),memory_total:8589934592,memory_available:4294967296,disks:[{name:'/',total:137438953472,available:68719476736}]},sampled_at:now,window:'1h',available:state!=='empty',retention_days:7,errors:[],targets:state==='empty'?[]:[{name:'node',up:true},{name:'cadvisor',up:true}],series:state==='empty'?{}:Object.fromEntries(['cpu','memory','disk','receive','transmit','load','swap','read','write'].map((key,index)=>[key,Array.from({length:121},(_,i)=>[now-3600+i*30,index<3?20+index*15+Math.sin(i*.15)*8:2048+Math.sin(i*.2)*1024])])),containers:state==='empty'?[]:['backend','frontend','postgres','prometheus','cadvisor'].map((name,index)=>({name:`genesis-${name}-1`,cpu:14-index*2,memory:1024*1024*(320-index*40),receive:4096,transmit:8192,uptime:18000,read:1024,write:2048}))}
function reply(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})}
window.fetch=async(input)=>{
  const url=new URL(input instanceof Request?input.url:String(input),location.origin);const path=url.pathname
  if(path.endsWith('/auth/me'))return reply(account)
  if(state==='slow')await new Promise(resolve=>setTimeout(resolve,1800))
  if(state==='error')return reply({detail:'合成数据读取失败'},503)
  if(path.endsWith('/admin/overview'))return reply(overview)
  if(path.endsWith('/admin/monitoring'))return reply(monitoring)
  if(path.endsWith('/admin/users'))return reply({items:state==='empty'||url.searchParams.get('q')?[]:[account],total:state==='empty'?0:1,page:1,page_size:20})
  if(path.endsWith('/admin/tasks'))return reply({items:state==='empty'?[]:[{id:'22222222-2222-4222-8222-222222222222',user_id:account.id,business:'media',kind:'image',status:'processing',created_at:new Date().toISOString(),completed_at:null},{id:'33333333-3333-4333-8333-333333333333',user_id:account.id,business:'blog',kind:'agent',status:'failed',created_at:new Date(Date.now()-90000).toISOString(),completed_at:new Date().toISOString()}],total:state==='empty'?0:2,page:1,page_size:20})
  if(path.endsWith('/billing/wallet'))return reply({available:'19.00000000',frozen:'0',currency:'CNY'})
  if(path.endsWith('/billing/users')||path.endsWith('/billing/policies'))return reply([])
  if(path.includes('/billing/'))return reply({items:[],total:0})
  return reply({detail:'未配置的合成接口'},404)
}
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[`/admin${params.get('view')?`/${params.get('view')}`:''}`]}><AdminPage/></MemoryRouter>)
