import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BlogAssistant } from '../src/features/blog/agent/BlogAssistant'
import type { AiGenerationMetrics } from '../src/lib/api'
import { studioAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/api')>(),
  listAiConversations: vi.fn().mockResolvedValue([]),
  getProviderModels: vi.fn().mockResolvedValue({ provider:'mimo', models:[
    {id:'mimo-v2.6-flash',name:'测试模型',context_window:1000000},
    {id:'other',name:'另一个模型',context_window:128000},
  ] }),
}))

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear() })
const metrics: AiGenerationMetrics = {
  input_tokens:18000,input_provider:'mimo',input_model:'mimo-v2.6-flash',
  output_tokens:729,token_source:'actual',output_seconds:1,tokens_per_second:729,
  first_token_seconds:1,total_seconds:2,
}

function mount(values: (AiGenerationMetrics | undefined)[]) {
  const key = 'genesis-blog-ai-conversation'
  localStorage.setItem(studioAuthTokenKey,'synthetic-context-test')
  sessionStorage.setItem(`${key}:model-choice`,JSON.stringify({provider:'mimo',model:'mimo-v2.6-flash'}))
  sessionStorage.setItem(key,JSON.stringify({isOpen:true,messages:values.map(value => ({
    role:'assistant',content:'可见正文很短',metrics:value,
  }))}))
  render(<BlogAssistant page={{route:'/blog/studio/posts',section:'posts',pageType:'posts_list'}} editor={null} />)
}

it('显示最近请求实际输入，不把可见文字、输出量或草稿当成完整上下文', async () => {
  mount([metrics])
  const ring = await screen.findByRole('progressbar',{name:'上下文用量 18,000 / 1M'})
  expect(Number(ring.getAttribute('aria-valuenow'))).toBeCloseTo(1.8)
  fireEvent.change(screen.getByRole('textbox',{name:'向博客助手提问'}),{target:{value:'草稿'.repeat(500)}})
  expect(ring).toHaveAccessibleName('上下文用量 18,000 / 1M')
  expect(ring.querySelector('.studio-assistant__ring-tooltip')).toHaveTextContent(/^18,000 \/ 1M$/)
})

it('旧消息缺少输入用量时显示未知，不按字符数给出估算百分比', async () => {
  mount([{...metrics,input_tokens:undefined}])
  expect(await screen.findByRole('img',{name:/上下文用量未知/})).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

it('切换模型后不套用之前模型的请求用量', async () => {
  mount([metrics])
  await screen.findByRole('progressbar',{name:/18,000/})
  fireEvent.click(screen.getByRole('button',{name:'选择模型'}))
  fireEvent.click(screen.getByRole('button',{name:'另一个模型'}))
  expect(screen.getByRole('img',{name:/上下文用量未知/})).toBeInTheDocument()
})

it('最新回复缺少统计时不倒退显示更早请求的用量', async () => {
  mount([metrics,undefined])
  expect(await screen.findByRole('img',{name:/上下文用量未知/})).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})
