import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { Activity, ArrowLeft, ArrowUpRight, Boxes, CircleGauge, LayoutGrid, Menu, RefreshCw, Server, Users, Wallet, X } from 'lucide-react'
import { GenesisLogo } from '../../components/GenesisLogo'
import { getCurrentUser, type CurrentUser } from '../../lib/api'
import { getStoredAuthToken } from '../../lib/auth'
import { useModalDialog } from '../../studio/useModalDialog'
import { WalletPage } from '../../features/billing/WalletPage'
import { amountLabel } from '../../features/billing/api'
import { adminGet, businesses, bytes, dateLabel, statuses, uptimeLabel, type AdminUser, type Monitoring, type Overview, type Page, type Task } from './api'
import '../../Account.css'
import './AdminPage.css'
import type { ProcessPage, ServicePage } from './api'
import { metricLabel } from './api'
import { MonitoringChart } from './MonitoringChart'
import { Cpu, MemoryStick, HardDrive, ArrowDownToLine, ArrowUpFromLine, Gauge, ArrowLeftRight, CheckCircle2, CircleAlert, CircleHelp, Clock3, Layers3, Terminal, Settings2, ChartNoAxesCombined, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

const navigation = [
  {path:'',name:'总览',icon:CircleGauge},{path:'server',name:'服务器',icon:Server},
  {path:'services',name:'服务与容器',icon:Boxes},{path:'users',name:'用户',icon:Users},
  {path:'business',name:'业务',icon:LayoutGrid},{path:'tasks',name:'任务',icon:Activity},
  {path:'billing',name:'账务',icon:Wallet},
]

function useAdminData<T>(path:string, refresh:number) {
  const [state,setState]=useState<{data?:T;error?:string;loading:boolean;path:string}>({loading:true,path})
  useEffect(()=>{
    const controller=new AbortController()
    void adminGet<T>(path,controller.signal).then(data=>{if(!controller.signal.aborted)setState({data,loading:false,path})})
      .catch((error:Error)=>{if(!controller.signal.aborted)setState({error:error.message,loading:false,path})})
    return ()=>controller.abort()
  },[path,refresh])
  return state.path===path ? state : {loading:true,path}
}

function State({loading,error,children}:{loading:boolean;error?:string;children:ReactNode}) {
  return error ? <div className="admin-state" role="alert">{error}，请点击右上角刷新重试。</div> : loading ? <div className="admin-state" role="status">正在读取…</div> : children
}

function MobileNav({close,children}:{close:()=>void;children:ReactNode}) {
  const button=useRef<HTMLButtonElement>(null); const dialog=useModalDialog(button)
  return <dialog ref={dialog} className="admin-mobile account-shell" aria-label="全站管理导航" onCancel={close}><button ref={button} onClick={close} aria-label="关闭导航"><X size={20}/></button>{children}</dialog>
}

export function AdminPage() {
  const token=getStoredAuthToken(); const location=useLocation()
  const [auth,setAuth]=useState<{user?:CurrentUser;error?:string;token?:string}>({})
  const [authAttempt,setAuthAttempt]=useState(0)
  const [refresh,setRefresh]=useState(0); const [menu,setMenu]=useState(false)
  const section=location.pathname.replace(/^\/admin\/?/,'')
  const item=navigation.find(row=>row.path===section)
  useEffect(()=>{
    let alive=true
    if(token) void getCurrentUser(token).then(user=>{if(alive)setAuth({user,token})}).catch((error:Error)=>{if(alive)setAuth({error:error.message,token})})
    return ()=>{alive=false}
  },[token,authAttempt])
  useEffect(()=>{document.title=`${item?.name ?? '页面不存在'} · 全站管理 · Genesis`},[item])
  if(!token) return <Navigate replace to={`/account?returnTo=${encodeURIComponent(location.pathname+location.search)}`}/>
  if(!auth.user || auth.token!==token) return <main className="admin-gate account-shell"><h1>全站管理</h1><p role={auth.error?'alert':'status'}>{auth.token===token && auth.error ? auth.error : '正在验证站长身份…'}</p>{auth.token===token && auth.error && <button onClick={()=>setAuthAttempt(n=>n+1)}>重试</button>}<Link to="/account">返回账户</Link></main>
  if(auth.user.role!=='owner') return <main className="admin-gate account-shell"><h1>仅站长可访问</h1><Link to="/account">返回账户</Link></main>
  const links=<nav aria-label="全站管理">{navigation.map((row,index)=><div key={row.path}>{(index===0 || index===3) && <p className="admin-nav-group">{index===0?'运行监控':'业务管理'}</p>}<Link to={`/admin${row.path?`/${row.path}`:''}`} aria-current={row.path===section?'page':undefined} onClick={()=>setMenu(false)}><row.icon size={18}/>{row.name}</Link></div>)}</nav>
  return <div className="admin-shell account-shell"><aside className="admin-sidebar"><Link className="admin-brand" to="/admin"><GenesisLogo/></Link>{links}<Link className="admin-back" to="/account"><ArrowLeft size={16}/>返回账户</Link></aside>
    <main className="admin-main"><header className="admin-header"><div><button className="admin-menu" aria-label="打开管理导航" onClick={()=>setMenu(true)}><Menu size={20}/></button><h1>{item?.name ?? '页面不存在'}</h1><span>全站管理</span></div><button aria-label="刷新数据" onClick={()=>setRefresh(n=>n+1)}><RefreshCw size={16}/>刷新</button></header>
      {!item ? <div className="admin-state"><p>未找到此管理页面。</p><Link to="/admin">返回总览</Link></div> : section==='billing' ? <WalletPage admin embedded refreshKey={refresh}/> : section==='users' ? <UsersView refresh={refresh}/> : section==='tasks' ? <TasksView refresh={refresh}/> : section==='business' ? <BusinessView refresh={refresh}/> : <MonitorView section={section} refresh={refresh}/>}
    </main>{menu && <MobileNav close={()=>setMenu(false)}>{links}</MobileNav>}
  </div>
}

const metricDefinitions:[string,string,string][]=[['cpu','CPU','%'],['memory','内存','%'],['disk','磁盘最高占用','%'],['receive','网络接收','/s'],['transmit','网络发送','/s'],['load','系统负载',''],['swap','Swap','bytes'],['read','磁盘读取','/s'],['write','磁盘写入','/s']]
const metricIcons:Record<string,LucideIcon>={cpu:Cpu,memory:MemoryStick,disk:HardDrive,receive:ArrowDownToLine,transmit:ArrowUpFromLine,load:Gauge,swap:ArrowLeftRight,read:ArrowDownToLine,write:ArrowUpFromLine}
function capacityPercent(used:number|null|undefined,total:number|null|undefined) {
  return used!=null&&total!=null&&total>0?used/total*100:null
}
function Capacity({used,total,showPercent=false}:{used:number|null|undefined;total:number|null|undefined;showPercent?:boolean}) {
  const percent=capacityPercent(used,total)
  return <div className="admin-capacity-meter"><div><span>{bytes(used)} <span className="admin-muted">/ {bytes(total)}</span></span>{showPercent&&<span>{metricLabel(percent,'%')}</span>}</div><div className="admin-meter-track" aria-hidden="true"><span style={{width:`${Math.min(100,Math.max(0,percent??0))}%`}}/></div></div>
}
function MemoryCell({used,total}:{used:number|null|undefined;total:number|null|undefined}) {
  return <><span>{bytes(used)}</span><small>{metricLabel(capacityPercent(used,total),'%')} · 占主机内存</small></>
}
function StatusIcon({state}:{state:string}) {
  const Icon=state==='failed'||state==='down'?CircleAlert:state==='active'||state==='up'||state==='R'?CheckCircle2:state==='unknown'?CircleHelp:Clock3
  return <Icon size={14} aria-hidden="true"/>
}

function MonitorView({section,refresh}:{section:string;refresh:number}) {
  const [params,setParams]=useSearchParams(); const window=['1h','24h','7d'].includes(params.get('window')??'')?params.get('window')!:'1h'
  const [tick,setTick]=useState(0)
  useEffect(()=>{const timer=setInterval(()=>{if(!document.hidden)setTick(n=>n+1)},30000);return ()=>clearInterval(timer)},[])
  const state=useAdminData<Monitoring>(`monitoring?window=${window}`,refresh+tick)
  const overview=useAdminData<Overview>('overview',refresh+tick)
  const data=state.data
  const memoryTotal=data?.details?.memory_total
  const memoryUsed=memoryTotal!=null&&data?.details?.memory_available!=null?memoryTotal-data.details.memory_available:null
  const fullestDisk=data?.details?.disks.filter(disk=>disk.total && disk.available!=null).sort((a,b)=>(1-b.available!/b.total!)-(1-a.available!/a.total!))[0]
  const hostView=(section==='server' && params.get('view')==='processes') || (section==='services' && params.get('view')==='system')
  const switcher=section!=='' && <div className="admin-toolbar"><div className="admin-segments" aria-label="监控视图">{(section==='server'?[['resources','资源概况'],['processes','进程占用']]:[['resources','容器资源'],['system','系统服务']]).map(([value,label])=><button key={value} aria-pressed={value==='resources'?!hostView:hostView} onClick={()=>{const next=new URLSearchParams(params);next.set('view',value!);next.delete('resource_page');setParams(next)}}>{value==='resources'?<ChartNoAxesCombined size={16} aria-hidden="true"/>:section==='server'?<Terminal size={16} aria-hidden="true"/>:<Settings2 size={16} aria-hidden="true"/>}{label}</button>)}</div></div>
  const renderMetric=([key,name,unit]:[string,string,string])=>{
    if(!data)return null
      const points=data.series[key]??[]; const point=points.at(-1); const current=key==='memory'&&memoryUsed!=null?capacityPercent(memoryUsed,memoryTotal):key==='disk'&&fullestDisk?capacityPercent(fullestDisk.total!-fullestDisk.available!,fullestDisk.total):point && data.sampled_at-point[0]<=120?point[1]:null
      const Icon=metricIcons[key]!
      return <section key={key} className={`admin-metric admin-metric--${key}`}><div className="admin-metric-summary"><h2><Icon size={18} aria-hidden="true"/>{name}</h2><strong>{metricLabel(current,unit)}</strong><div className="admin-metric-detail">{key==='memory'?<Capacity used={memoryUsed} total={memoryTotal}/>:key==='disk'?<><Capacity used={fullestDisk?fullestDisk.total!-fullestDisk.available!:null} total={fullestDisk?.total}/><span className="admin-mount-name" title={fullestDisk?.name}>{fullestDisk?.name??'挂载点未知'}</span></>:<span>{key==='cpu'?`${data.details?.cores.length||'—'} 个逻辑核心`:key==='load'?'1 分钟平均负载':key==='swap'?'已使用交换空间':'实时传输速率'}</span>}</div></div><MonitoringChart points={points} name={name} unit={unit} start={data.sampled_at-({ '1h':3600,'24h':86400,'7d':604800 }[window]??3600)} end={data.sampled_at}/></section>
  }
  if(hostView)return <>{switcher}<HostResources kind={section==='server'?'processes':'system-services'} refresh={refresh+tick} memoryTotal={memoryTotal}/></>
  return <>{switcher}<div className="admin-toolbar"><div className="admin-segments" aria-label="监控时间范围">{([['1h','1 小时'],['24h','24 小时'],['7d','7 天']] as const).map(([value,label])=><button key={value} aria-pressed={window===value} onClick={()=>{const next=new URLSearchParams(params);next.set('window',value);setParams(next)}}>{label}</button>)}</div><span>{data?`${new Date(data.sampled_at*1000).toLocaleTimeString('zh-CN')} 更新 · 每 30 秒刷新`:'每 30 秒刷新'}</span></div>
    <State {...state}>{data && <>{!data.available ? <div className="admin-notice"><strong>监控未接入或暂不可用</strong><p>启动监控采集服务后，这里会显示资源占用与历史趋势。</p></div> : <div className="admin-targets">{data.targets.map(target=><span key={target.name} className={!target.up?'admin-warning':''}>{{node:'服务器采集','node-network':'主机网络采集',cadvisor:'容器采集'}[target.name]??target.name}<StatusIcon state={target.up?'up':'down'}/>{target.up?'在线':'中断'}</span>)}{data.errors.length>0 && <span className="admin-warning">部分指标读取失败</span>}</div>}
    {section!=='services' && (section===''?<div className="admin-metrics admin-overview-layout"><div className="admin-resource-stack" aria-label="服务器资源">{metricDefinitions.slice(0,3).map(renderMetric)}</div><div className="admin-network-panel"><h2 className="admin-network-title"><ArrowLeftRight size={18} aria-hidden="true"/>网络流量</h2><div className="admin-network-metrics">{metricDefinitions.slice(3,5).map(renderMetric)}</div></div></div>:<div className="admin-metrics">{metricDefinitions.map(renderMetric)}</div>)}
    {section==='server' && data.details && <><section className="admin-section"><h2><Cpu size={18} aria-hidden="true"/>CPU 各核心</h2><div className="admin-cores">{data.details.cores.map(core=><div key={core.name}><span>核心 {core.name}</span><strong>{metricLabel(core.usage,'%')}</strong></div>)}</div>{!data.details.cores.length && <p className="admin-empty">暂无核心样本</p>}</section><section className="admin-section"><h2><HardDrive size={18} aria-hidden="true"/>可写挂载盘</h2><div className="admin-table-wrap"><table><thead><tr><th>挂载点</th><th>已占用 / 总容量</th><th>可用容量</th></tr></thead><tbody>{data.details.disks.map(disk=><tr key={disk.name}><td><span className="admin-icon-label"><HardDrive size={16} aria-hidden="true"/>{disk.name}</span></td><td><Capacity used={disk.total!=null&&disk.available!=null?disk.total-disk.available:null} total={disk.total} showPercent/></td><td>{bytes(disk.available)}</td></tr>)}</tbody></table>{!data.details.disks.length && <p className="admin-empty">暂无磁盘样本</p>}</div></section></>}
    {(section==='' || section==='services') && <section className="admin-section"><div className="admin-section-heading"><h2><Boxes size={18} aria-hidden="true"/>容器资源</h2><span>按内存占用排序 · CPU 100% = 1 核</span></div><div className="admin-table-wrap"><table><thead><tr><th>容器</th><th><span className="admin-icon-label"><Cpu size={14} aria-hidden="true"/>CPU</span></th><th><span className="admin-icon-label"><MemoryStick size={14} aria-hidden="true"/>内存</span></th><th>接收 / 发送</th><th>读取 / 写入</th><th>运行时长</th></tr></thead><tbody>{data.containers.map(row=><tr key={row.name}><td><span className="admin-icon-label"><Boxes size={16} aria-hidden="true"/>{row.name}</span></td><td>{metricLabel(row.cpu,'%')}</td><td><MemoryCell used={row.memory} total={memoryTotal}/></td><td>{metricLabel(row.receive,'/s')} · {metricLabel(row.transmit,'/s')}</td><td>{metricLabel(row.read,'/s')} · {metricLabel(row.write,'/s')}</td><td>{uptimeLabel(row.uptime)}</td></tr>)}</tbody></table>{!data.containers.length && <p className="admin-empty">暂无容器样本</p>}</div><p className="admin-caption">采集状态不代表应用健康；运行时长来自当前容器启动时间。</p></section>}
    </>}</State>
    {section==='' && <State {...overview}>{overview.data && <section className="admin-section"><h2>全站运行</h2><div className="admin-totals"><Link to="/admin/users"><span>用户</span><strong>{overview.data.users}</strong></Link><Link to="/admin/tasks?hours=24"><span>近 24 小时任务</span><strong>{overview.data.tasks_24h}</strong></Link><Link to="/admin/tasks?status=failed&hours=24"><span>近 24 小时失败</span><strong>{overview.data.statuses.failed??0}</strong></Link><Link to="/admin/billing"><span>待核对账务</span><strong>{overview.data.review_orders}</strong></Link></div></section>}</State>}
  </>
}

const processStates:Record<string,string>={R:'运行',S:'休眠',D:'等待 I/O',Z:'僵尸',T:'已停止',t:'跟踪停止',I:'空闲',X:'已退出'}
const serviceStates:Record<string,string>={active:'活动',inactive:'未活动',failed:'失败',activating:'启动中',deactivating:'停止中',unknown:'未知'}
function HostResources({kind,refresh,memoryTotal}:{kind:'processes'|'system-services';refresh:number;memoryTotal?:number|null}) {
  const [params,setParams]=useSearchParams()
  const processes=kind==='processes'
  const scope=['host','isolated','all'].includes(params.get('scope')??'')?params.get('scope')!:'host'
  const sort=params.get('sort')==='memory'?'memory':'cpu'
  const status=['active','inactive','failed'].includes(params.get('service_state')??'')?params.get('service_state')!:'all'
  const page=Math.max(1,Number(params.get('resource_page'))||1)
  const query=processes?`scope=${scope}&sort=${sort}&page=${page}`:`state=${status}&page=${page}`
  const result=useAdminData<ProcessPage|ServicePage>(`${kind}?${query}`,refresh)
  const change=(key:string,value:string)=>{const next=new URLSearchParams(params);next.delete('resource_page');next.set(key,value);setParams(next)}
  const data=result.data
  return <section className="admin-section" aria-label={processes?'宿主机进程':'系统服务'}><div className="admin-section-heading"><h2>{processes?<Terminal size={18} aria-hidden="true"/>:<Settings2 size={18} aria-hidden="true"/>}{processes?'宿主机进程':'系统服务'}</h2><span>{processes?'CPU 100% = 1 核 · 内存为 RSS':'systemd 已加载服务 · 失败优先'}</span></div>
    <div className="admin-toolbar"><div className="admin-segments" aria-label={processes?'进程范围':'服务状态'}>{(processes?[['host','宿主进程'],['isolated','隔离进程'],['all','全部进程']]:[['all','全部服务'],['active','活动'],['failed','失败'],['inactive','未活动']]).map(([value,label])=><button key={value} aria-pressed={(processes?scope:status)===value} onClick={()=>change(processes?'scope':'service_state',value!)}>{processes?(value==='host'?<Server size={15} aria-hidden="true"/>:value==='isolated'?<Boxes size={15} aria-hidden="true"/>:<Layers3 size={15} aria-hidden="true"/>):value==='all'?<Layers3 size={15} aria-hidden="true"/>:<StatusIcon state={value!}/>} {label}</button>)}</div>{processes && <div className="admin-segments" aria-label="进程排序">{[['cpu','CPU 排序'],['memory','内存排序']].map(([value,label])=><button key={value} aria-pressed={sort===value} onClick={()=>change('sort',value!)}>{value==='cpu'?<Cpu size={15} aria-hidden="true"/>:<MemoryStick size={15} aria-hidden="true"/>}{label}</button>)}</div>}</div>
    <State {...result}>{data && <>{'supported' in data && !data.supported?<p className="admin-empty">当前主机未使用 systemd，无法展示系统服务。</p>:<><div className="admin-table-wrap admin-resource-table"><table><thead>{processes?<tr><th>进程 / PID</th><th>范围</th><th>状态</th><th>CPU</th><th>内存</th><th>线程</th><th>运行时长</th></tr>:<tr><th>服务</th><th>状态</th><th>自动重启</th><th>活动时长</th></tr>}</thead><tbody>{'supported' in data?data.items.map(row=><tr key={row.name}><td><span className="admin-icon-label"><Settings2 size={15} aria-hidden="true"/>{row.name}</span></td><td className={row.state==='failed'?'admin-warning':''}><span className="admin-icon-label"><StatusIcon state={row.state}/>{serviceStates[row.state]??'未知'}</span></td><td>{row.restarts??'—'}</td><td>{uptimeLabel(row.uptime)}</td></tr>):data.items.map(row=><tr key={row.pid}><td><strong className="admin-icon-label"><Terminal size={15} aria-hidden="true"/>{row.name}</strong><small>PID {row.pid}</small></td><td>{{host:'宿主',isolated:'隔离',unknown:'未知'}[row.scope]??'未知'}</td><td><span className="admin-icon-label"><StatusIcon state={row.state}/>{processStates[row.state]??'未知'}</span></td><td>{metricLabel(row.cpu,'%')}</td><td><MemoryCell used={row.memory} total={memoryTotal}/></td><td>{row.threads}</td><td>{uptimeLabel(row.uptime)}</td></tr>)}</tbody></table>{!data.items.length && <p className="admin-empty">{processes?'暂无符合条件的进程':'暂无符合条件的服务'}</p>}</div><Pagination data={data} change={page=>change('resource_page',String(page))}/></>}
      {'skipped' in data && (data.skipped>0 || data.truncated) && <p className="admin-caption">{data.skipped>0?`${data.skipped} 个进程已退出或无读取权限。`:''}{data.truncated?'进程超过采集上限，仅展示前 20,000 个进程。':''}</p>}
      <p className="admin-caption">{new Date(data.sampled_at*1000).toLocaleTimeString('zh-CN')} 更新 · 每 30 秒刷新</p><p className="admin-caption">{processes?'按资源组识别 Docker、Kubernetes、Podman 与 LXC 隔离进程；首个 CPU 样本显示未知。':'“活动”不等于应用健康；自动重启仅计 systemd 的 Restart 触发次数。'}</p>
    </>}</State>
  </section>
}

function Pagination({data,change}:{data:Page<unknown>;change:(page:number)=>void}) {
  const pages=Math.max(1,Math.ceil(data.total/data.page_size))
  return <div className="admin-pagination"><span>共 {data.total} 条 · 第 {data.page} / {pages} 页</span><div><button disabled={data.page<=1} onClick={()=>change(data.page-1)}><ChevronLeft size={15} aria-hidden="true"/>上一页</button><button disabled={data.page>=pages} onClick={()=>change(data.page+1)}>下一页<ChevronRight size={15} aria-hidden="true"/></button></div></div>
}
function UsersView({refresh}:{refresh:number}) {
  const [params,setParams]=useSearchParams(); const q=params.get('q')??''
  const [draft,setDraft]=useState(q);const [composing,setComposing]=useState(false);const input=useRef<HTMLInputElement>(null)
  const [previousQuery,setPreviousQuery]=useState(q)
  if(previousQuery!==q){setPreviousQuery(q);if(draft!==q)setDraft(q)}
  const state=useAdminData<Page<AdminUser>>(`users?${params}`,refresh)
  useEffect(()=>{if(composing || draft===q)return;const timer=setTimeout(()=>setParams(draft?{q:draft}:{}),300);return ()=>clearTimeout(timer)},[draft,q,composing,setParams])
  return <><form className="admin-search" noValidate onSubmit={event=>{event.preventDefault();if(!composing)setParams(draft?{q:draft}:{})}}><label htmlFor="admin-user-search">搜索用户</label><input id="admin-user-search" ref={input} value={draft} maxLength={100} placeholder="账号或昵称" onChange={event=>setDraft(event.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}/>{draft && <button type="button" aria-label="清除用户搜索" onClick={()=>{setDraft('');setParams({});input.current?.focus()}}><X size={16}/></button>}</form>
    <State {...state}>{state.data && <><div className="admin-table-wrap"><table><thead><tr><th>用户</th><th>角色</th><th>可用余额</th><th>注册时间</th><th>记录</th></tr></thead><tbody>{state.data.items.map(user=><tr key={user.id}><td><strong>{user.display_name}</strong><small>@{user.handle}</small></td><td>{user.role==='owner'?'站长':'成员'}</td><td>{user.available===null?'未初始化':amountLabel(user.available)}</td><td>{dateLabel(user.created_at)}</td><td><Link to={`/admin/tasks?user_id=${user.id}`}>查看任务 <ArrowUpRight size={13}/></Link></td></tr>)}</tbody></table>{!state.data.items.length && <p className="admin-empty">{q?'没有匹配的用户':'暂无用户'}</p>}</div><Pagination data={state.data} change={page=>setParams({...Object.fromEntries(params),page:String(page)})}/></>}</State>
  </>
}
function TasksView({refresh}:{refresh:number}) {
  const [params,setParams]=useSearchParams(); const state=useAdminData<Page<Task>>(`tasks?${params}`,refresh)
  function filter(key:string,value:string){const next=new URLSearchParams(params);if(value)next.set(key,value);else next.delete(key);if(key!=='page')next.delete('page');setParams(next)}
  return <><div className="admin-toolbar"><div className="admin-segments" aria-label="业务筛选">{([['','全部业务'],...Object.entries(businesses)] as [string,string][]).map(([key,name])=><button key={key} aria-pressed={(params.get('business')??'')===key} onClick={()=>filter('business',key)}>{name}</button>)}</div><label>状态 <select value={params.get('status')??''} onChange={event=>filter('status',event.target.value)}><option value="">全部状态</option>{Object.entries(statuses).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>{params.get('user_id') && <button onClick={()=>filter('user_id','')}>清除用户筛选</button>}</div>
    {params.get('hours')==='24' && <div className="admin-toolbar"><span>最近 24 小时</span><button onClick={()=>filter('hours','')}>查看全部时间</button></div>}
    <State {...state}>{state.data && <><div className="admin-table-wrap"><table><thead><tr><th>任务</th><th>业务</th><th>状态</th><th>开始时间</th><th>耗时</th></tr></thead><tbody>{state.data.items.map(task=><tr key={`${task.kind}-${task.id}`}><td><strong>{{agent:'AI 对话',svg:'SVG 生成',image:'图片生成',video:'视频生成'}[task.kind]??task.kind}</strong><small title={task.id}>{task.id}</small></td><td>{businesses[task.business]??task.business}</td><td><span className={task.status==='failed'?'admin-warning':''}>{statuses[task.status]??task.status}</span></td><td>{dateLabel(task.created_at)}</td><td>{task.completed_at?`${Math.max(0,Math.round((Date.parse(task.completed_at)-Date.parse(task.created_at))/1000))} 秒`:'—'}</td></tr>)}</tbody></table>{!state.data.items.length && <p className="admin-empty">暂无符合条件的任务</p>}</div><Pagination data={state.data} change={page=>filter('page',String(page))}/></>}</State>
  </>
}
function BusinessView({refresh}:{refresh:number}) {
  const state=useAdminData<Overview>('overview',refresh)
  return <State {...state}>{state.data && <div className="admin-businesses">{([['blog','/blog/studio',`${state.data.posts} 篇文章`],['media','/media',`${state.data.projects} 个作品 · ${state.data.assets} 个素材`],['toolbox','/toolbox','浏览器本地工具不计入服务端任务']] as const).map(([key,path,description])=><section key={key}><h2>{businesses[key]}</h2><p>{description}</p><strong>{state.data!.businesses.find(row=>row.business===key)?.tasks??0}<small>累计 AI 任务</small></strong><Link to={path}>进入工作台 <ArrowUpRight size={16}/></Link></section>)}</div>}</State>
}
