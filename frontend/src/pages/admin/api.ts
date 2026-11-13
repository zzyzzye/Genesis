import { request } from '../../lib/api'
import { getStoredAuthToken } from '../../lib/auth'

export type Overview = { users:number; posts:number; projects:number; assets:number; tasks_24h:number; statuses:Record<string,number>; review_orders:number; businesses:{business:string;tasks:number}[] }
export type AdminUser = { id:string;handle:string;display_name:string;role:string;created_at:string;available:string|null }
export type Task = { id:string;user_id:string;business:string;kind:string;status:string;created_at:string;completed_at:string|null }
export type Page<T> = { items:T[];total:number;page:number;page_size:number }
export type HostProcess = {pid:number;name:string;state:string;scope:string;cpu:number|null;memory:number;threads:number;uptime:number}
export type SystemService = {name:string;state:string;restarts:number|null;uptime:number|null}
export type ProcessPage = Page<HostProcess> & {sampled_at:number;skipped:number;truncated:boolean}
export type ServicePage = Page<SystemService> & {sampled_at:number;supported:boolean}
export type Point = [number,number|null]
export type Container = {name:string} & Partial<Record<'cpu'|'memory'|'receive'|'transmit'|'uptime'|'read'|'write',number|null>>
export type Monitoring = {sampled_at:number;window:string;series:Record<string,Point[]>;containers:Container[];targets:{name:string;up:boolean}[];errors:string[];available:boolean;retention_days:number;details?:{cores:{name:string;usage:number|null}[];memory_total:number|null;memory_available:number|null;disks:{name:string;total?:number|null;available?:number|null}[]}}
export const businesses:Record<string,string> = {blog:'博客',media:'媒体',toolbox:'工具箱'}
export const statuses:Record<string,string> = {pending:'待启动',running:'运行中',completed:'已完成',failed:'失败',submitting:'提交中',queued:'排队中',processing:'生成中',downloading:'保存中',unknown:'状态待核实',download_failed:'保存失败',acknowledged:'已确认重试'}
export function adminGet<T>(path:string, signal:AbortSignal) {
  return request<T>(`/admin/${path}`,{signal,cache:'no-store',headers:{Authorization:`Bearer ${getStoredAuthToken() ?? ''}`}})
}
export function dateLabel(value:string) {
  return new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})
}
export function bytes(value:number|null|undefined) {
  if(value == null) return '—'
  const units=['B','KiB','MiB','GiB','TiB']; let index=0
  while(value>=1024 && index<units.length-1){value/=1024;index++}
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`
}

export function metricLabel(value:number|null|undefined,unit:string) {
  if(value==null)return '—'
  return unit==='bytes'||unit==='/s'?`${bytes(value)}${unit==='/s'?'/s':''}`:`${value.toFixed(1)}${unit}`
}

export function uptimeLabel(value:number|null|undefined) {
  if(value==null)return '—'
  const days=Math.floor(value/86400),hours=Math.floor(value%86400/3600),minutes=Math.floor(value%3600/60)
  return days?`${days}天${hours}小时`:hours?`${hours}小时${minutes}分`:minutes?`${minutes}分钟`:`${Math.max(0,Math.floor(value))}秒`
}
