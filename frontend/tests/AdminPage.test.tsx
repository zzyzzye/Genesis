import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

it('成员被阻止且不请求管理数据',async()=>{
  vi.mocked(getCurrentUser).mockResolvedValue({...user,role:'member'})
  open();expect(await screen.findByText('仅站长可访问')).toBeInTheDocument();expect(adminGet).not.toHaveBeenCalled()
})
it('监控缺失不显示零占用，业务统计仍可读取',async()=>{
  vi.mocked(adminGet).mockImplementation((path)=>Promise.resolve(path.startsWith('monitoring')?{sampled_at:100,series:{},targets:[],containers:[],errors:[],available:false}:{users:2,posts:0,projects:0,assets:0,tasks_24h:3,statuses:{failed:1},review_orders:0,businesses:[]}))
  open();expect(await screen.findByText('监控未接入或暂不可用')).toBeInTheDocument();expect(screen.queryByText('0.0%')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'24 小时'}))
  await waitFor(()=>expect(adminGet).toHaveBeenCalledWith('monitoring?window=24h',expect.any(AbortSignal)))
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
