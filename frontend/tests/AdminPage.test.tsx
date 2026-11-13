import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminPage } from '../src/pages/admin/AdminPage'
import { getCurrentUser } from '../src/lib/api'
import { adminGet } from '../src/pages/admin/api'

vi.mock('../src/lib/api',async importOriginal=>({...await importOriginal<typeof import('../src/lib/api')>(),getCurrentUser:vi.fn()}))
vi.mock('../src/pages/admin/api',async importOriginal=>({...await importOriginal<typeof import('../src/pages/admin/api')>(),adminGet:vi.fn()}))
const user={id:'synthetic',handle:'synthetic',display_name:'测试站长',role:'owner',bio:'',avatar_url:null}
function open(path='/admin'){return render(<MemoryRouter initialEntries={[path]}><AdminPage/></MemoryRouter>)}
beforeEach(()=>{localStorage.setItem('genesis-account-token','synthetic-admin');vi.mocked(getCurrentUser).mockResolvedValue(user)})
afterEach(()=>{cleanup();localStorage.clear();vi.resetAllMocks()})

it('切回宿主机重新确认离线状态，快速切换不接受旧请求回写',async()=>{
  const offline={sampled_at:100,source:'macos',series:{},targets:[{name:'native-host',up:false},{name:'cadvisor',up:true}],containers:[],errors:[],available:false}
  let recover=false
  let pending:((data:unknown)=>void)|undefined
  let requests=0
  vi.mocked(adminGet).mockImplementation(path=>{
    if(!path.startsWith('monitoring'))return Promise.resolve({users:0,tasks_24h:0,statuses:{},review_orders:0})
    requests++
    if(requests===2)return new Promise(resolve=>{pending=resolve})
    return Promise.resolve(recover?{...offline,available:true,targets:[{name:'native-host',up:true},{name:'cadvisor',up:true}]}:offline)
  })
  open()
  await screen.findByText('macOS 宿主采集已离线')
  fireEvent.click(screen.getByRole('button',{name:'容器'}))
  await waitFor(()=>expect(requests).toBe(2))
  recover=true
  fireEvent.click(screen.getByRole('button',{name:'宿主机'}))
  await waitFor(()=>expect(screen.queryByText('macOS 宿主采集已离线')).not.toBeInTheDocument())
  await act(async()=>{pending?.(offline);await Promise.resolve()})
  await waitFor(()=>expect(requests).toBe(3))
  expect(screen.queryByText('macOS 宿主采集已离线')).not.toBeInTheDocument()
  recover=false
  fireEvent.click(screen.getByRole('button',{name:'刷新数据'}))
  await screen.findByText('macOS 宿主采集已离线')
})

it('进程分页保留范围，切换排序重置页码',async()=>{
  vi.mocked(adminGet).mockImplementation((path)=>Promise.resolve(path.startsWith('processes')?{items:[],total:25,page:1,page_size:20,sampled_at:100,skipped:0,truncated:false}:{}))
  open('/admin/server?view=processes&scope=all')
  fireEvent.click(await screen.findByRole('button',{name:'下一页'}))
  await waitFor(()=>expect(adminGet).toHaveBeenCalledWith('processes?scope=all&sort=cpu&page=2',expect.any(AbortSignal)))
  fireEvent.click(screen.getByRole('button',{name:'内存排序'}))
  await waitFor(()=>expect(adminGet).toHaveBeenCalledWith('processes?scope=all&sort=memory&page=1',expect.any(AbortSignal)))
})
it('区分不支持 systemd 与采集失败',async()=>{
  vi.mocked(adminGet).mockImplementation((path)=>Promise.resolve(path.startsWith('system-services')?{items:[],total:0,page:1,page_size:20,sampled_at:100,supported:false}:{}))
  open('/admin/services?view=system')
  expect(await screen.findByText('当前主机未使用 systemd，无法展示系统服务。')).toBeInTheDocument()
  vi.mocked(adminGet).mockRejectedValue(new Error('系统服务采集暂不可用'))
  fireEvent.click(screen.getByRole('button',{name:'刷新数据'}))
  expect(await screen.findByRole('alert')).toHaveTextContent('系统服务采集暂不可用')
})

it('成员被阻止且不请求管理数据',async()=>{
  vi.mocked(getCurrentUser).mockResolvedValue({...user,role:'member'})
  open();expect(await screen.findByText('仅站长可访问')).toBeInTheDocument();expect(adminGet).not.toHaveBeenCalled()
})
it('内存与磁盘同时展示实际容量和百分比',async()=>{
  vi.mocked(adminGet).mockImplementation((path)=>Promise.resolve(path.startsWith('monitoring')?{sampled_at:100,series:{},targets:[],containers:[],errors:[],available:true,details:{cores:[],memory_total:8*1024**3,memory_available:2*1024**3,disks:[{name:'/',total:200*1024**3,available:100*1024**3}]}}:{users:0,posts:0,projects:0,assets:0,tasks_24h:0,statuses:{},review_orders:0,businesses:[]}))
  open()
  expect(await screen.findByText('75.0%')).toBeInTheDocument()
  expect(screen.getByText('6.0 GiB')).toBeInTheDocument()
  expect(screen.getByText('/ 8.0 GiB')).toBeInTheDocument()
  expect(screen.getByText('50.0%')).toBeInTheDocument()
  expect(screen.getByText('100.0 GiB')).toBeInTheDocument()
})
it('监控缺失不显示零占用，业务统计仍可读取',async()=>{
  vi.mocked(adminGet).mockImplementation((path)=>Promise.resolve(path.startsWith('monitoring')?{sampled_at:100,series:{},targets:[],containers:[],errors:[],available:false}:{users:2,posts:0,projects:0,assets:0,tasks_24h:3,statuses:{failed:1},review_orders:0,businesses:[]}))
  open();expect(await screen.findByText('监控未接入或暂不可用')).toBeInTheDocument();expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'24 小时'}))
  await waitFor(()=>expect(adminGet).toHaveBeenCalledWith('monitoring?window=24h',expect.any(AbortSignal)))
})
it('总览切换主趋势，保留所选时间范围',async()=>{
  vi.mocked(adminGet).mockImplementation((path)=>Promise.resolve(path.startsWith('monitoring')?{sampled_at:100,series:{},targets:[],containers:[],errors:[],available:false}:{users:0,posts:0,projects:0,assets:0,tasks_24h:0,statuses:{},review_orders:0,businesses:[]}))
  open('/admin?window=24h&metric=memory')
  expect(await screen.findByRole('img',{name:/内存趋势/})).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'网络'}))
  expect(await screen.findByRole('img',{name:/接收与发送趋势/})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'24 小时'})).toHaveAttribute('aria-pressed','true')
})
it('服务器扩展趋势保留单位、读写对比及视图切换状态',async()=>{
  vi.mocked(adminGet).mockImplementation(path=>Promise.resolve(path.startsWith('monitoring')?{sampled_at:100,series:{swap:[[100,1024]],load:[[100,1.5]],read:[[100,2048]],write:[[100,4096]]},targets:[],containers:[],errors:[],available:true}:path.startsWith('processes')?{items:[],total:0,page:1,page_size:20,sampled_at:100}:{}))
  open('/admin/server?window=24h&metric=swap')
  expect(await screen.findByRole('img',{name:/Swap趋势/})).toBeInTheDocument()
  expect(screen.getByText('1.0 KiB')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'负载'}))
  expect(screen.getByText('1.5')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'磁盘 I/O'}))
  expect(screen.getByRole('img',{name:/读取与写入趋势/})).toBeInTheDocument()
  expect(screen.getByText('2.0 KiB/s')).toBeInTheDocument()
  expect(screen.getByText('4.0 KiB/s')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'进程占用'}))
  await screen.findByText('暂无符合条件的进程')
  fireEvent.click(screen.getByRole('button',{name:'资源概况'}))
  expect(await screen.findByRole('img',{name:/读取与写入趋势/})).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'24 小时'})).toHaveAttribute('aria-pressed','true')
})
it('服务器显示硬件型号并区分不可见与采集失败',async()=>{
  const hardware={cpu_names:['Test CPU'],cpu_state:'available',gpus:[{name:'Test GPU',model_known:true,pci_id:'1234:5678'}],gpu_state:'available'}
  vi.mocked(adminGet).mockImplementation(path=>Promise.resolve(path.startsWith('monitoring')?{sampled_at:100,series:{},targets:[],containers:[],errors:[],available:true,hardware}:{}))
  open('/admin/server')
  expect(await screen.findByText('Test CPU')).toBeInTheDocument()
  expect(screen.getByText('Test GPU')).toBeInTheDocument()
  hardware.gpus=[];hardware.gpu_state='not_detected'
  fireEvent.click(screen.getByRole('button',{name:'刷新数据'}))
  expect(await screen.findByText('未检测到可见 GPU')).toBeInTheDocument()
  hardware.gpu_state='unavailable'
  fireEvent.click(screen.getByRole('button',{name:'刷新数据'}))
  expect(await screen.findByText('型号采集不可用')).toBeInTheDocument()
})
it('宿主与容器内存口径分开，离线不伪装成 Linux 资源',async()=>{
  const data={sampled_at:100,source:'macos',series:{},current:{cpu:20},targets:[{name:'cadvisor',up:true}],containers:[{name:'test-container',memory:1024**3}],container_memory_total:4*1024**3,errors:[],available:true,details:{cores:[],memory_total:16*1024**3,memory_available:8*1024**3,disks:[]}}
  vi.mocked(adminGet).mockImplementation(path=>Promise.resolve(path.startsWith('monitoring')?data:{users:0,tasks_24h:0,statuses:{},review_orders:0}))
  open('/admin?window=24h&metric=cpu')
  expect(await screen.findByText('macOS 宿主机')).toBeInTheDocument()
  expect(screen.getAllByText('20.0%').length).toBeGreaterThan(0)
  expect(screen.getByText('/ 16.0 GiB')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'容器'}))
  expect(screen.getByText('25.0%')).toBeInTheDocument()
  expect(screen.getByText('内存占比基于Docker 虚拟机 · 4.0 GiB')).toBeInTheDocument()
  expect(screen.queryByText('/ 16.0 GiB')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'宿主机'}))
  expect(screen.getByRole('button',{name:'24 小时'})).toHaveAttribute('aria-pressed','true')
  expect(screen.getByRole('img',{name:/CPU趋势/})).toBeInTheDocument()
  data.available=false
  fireEvent.click(screen.getByRole('button',{name:'刷新数据'}))
  expect(await screen.findByText('macOS 宿主采集已离线')).toBeInTheDocument()
  expect(screen.queryByText('Linux / Docker 采集环境')).not.toBeInTheDocument()
  await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'容器'}));await Promise.resolve()})
  expect(screen.queryByText('macOS 宿主采集已离线')).not.toBeInTheDocument()
  expect(screen.queryByText('容器采集暂不可用')).not.toBeInTheDocument()
  expect(screen.getByText('test-container')).toBeInTheDocument()
})
it('总览容器可展开收起，完整名称仍可识别',async()=>{
  vi.mocked(adminGet).mockImplementation(path=>Promise.resolve(path.startsWith('monitoring')?{sampled_at:100,series:{},targets:[],containers:Array.from({length:8},(_,i)=>({name:`genesis-service-${i}`,memory:1024})),errors:[],available:true}:{users:0,tasks_24h:0,statuses:{},review_orders:0}))
  open('/admin?monitor=containers')
  const expand=await screen.findByRole('button',{name:'展开其余 3 个容器'})
  expect(screen.queryByLabelText('genesis-service-7')).not.toBeInTheDocument()
  fireEvent.click(expand)
  expect(screen.getByLabelText('genesis-service-7')).toHaveTextContent('service-7')
  fireEvent.click(screen.getByRole('button',{name:'收起'}))
  expect(screen.queryByLabelText('genesis-service-7')).not.toBeInTheDocument()
})
it('任务下一页保留业务筛选，切换业务重置页码',async()=>{
  vi.mocked(adminGet).mockResolvedValue({items:[],total:23,page:1,page_size:20})
  open('/admin/tasks?business=media')
  fireEvent.click(await screen.findByRole('button',{name:'下一页'}))
  await waitFor(()=>expect(adminGet).toHaveBeenCalledWith('tasks?business=media&page=2',expect.any(AbortSignal)))
  fireEvent.click(screen.getByRole('button',{name:'博客'}))
  await waitFor(()=>expect(adminGet).toHaveBeenCalledWith('tasks?business=blog',expect.any(AbortSignal)))
})
it('搜索等待输入法完成，清除立即恢复列表',async()=>{
  vi.mocked(adminGet).mockResolvedValue({items:[],total:0,page:1,page_size:20})
  open('/admin/users');const input=await screen.findByRole('textbox',{name:'搜索用户'})
  fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'测试'}})
  expect(adminGet).not.toHaveBeenCalledWith('users?q=%E6%B5%8B%E8%AF%95',expect.any(AbortSignal))
  fireEvent.compositionEnd(input)
  await waitFor(()=>expect(adminGet).toHaveBeenCalledWith('users?q=%E6%B5%8B%E8%AF%95',expect.any(AbortSignal)))
  fireEvent.click(screen.getByRole('button',{name:'清除用户搜索'}));expect(input).toHaveValue('');expect(input).toHaveFocus()
  await waitFor(()=>expect(adminGet).toHaveBeenLastCalledWith('users?',expect.any(AbortSignal)))
})
