import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MediaAssistant } from '../src/pages/media/MediaAssistant'
import { getProviderModels, type ProviderModels } from '../src/lib/api'
import { accountAuthTokenKey } from '../src/lib/auth'

vi.mock('../src/lib/api', async (original) => ({
  ...await original<typeof import('../src/lib/api')>(),
  getProviderModels: vi.fn(),
}))

afterEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks() })

it('价格尚未返回时可选模型，价格完成不重置选择，刷新失败保留目录', async () => {
  localStorage.setItem(accountAuthTokenKey, 'synthetic-model-review')
  const catalog: ProviderModels = { provider: 'openai', models: [
    { id: 'alpha', name: 'Alpha', created: null, context_window: null },
    { id: 'beta', name: 'Beta', created: null, context_window: null },
  ] }
  let priceDone!: (value: ProviderModels) => void
  const prices = new Promise<ProviderModels>(resolve => { priceDone = resolve })
  vi.mocked(getProviderModels).mockImplementation((_token, _provider, options) => options?.includePricing ? prices : Promise.resolve(catalog))
  render(<MediaAssistant userId="catalog-test" attachmentsAllowed page="projects" selectedNode={null} />)
  fireEvent.click(screen.getByRole('button', { name: '镜头搭档' }))
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Beta' }))
  expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('Beta')
  await act(async () => { priceDone(catalog); await prices })
  expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('Beta')
  vi.mocked(getProviderModels).mockRejectedValue(new Error('目录暂不可用'))
  const trigger = screen.getByRole('button', { name: '选择模型' })
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('button', { name: '刷新模型与价格' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('目录暂不可用'))
  expect(screen.getByRole('button', { name: 'Beta' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Alpha' })).toBeEnabled()
})
