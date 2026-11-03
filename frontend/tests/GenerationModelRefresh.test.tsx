import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ImageGeneration, VideoGeneration } from '../src/pages/media/VideoGeneration'
import { defaultGenerationSettings, type Node } from '../src/pages/media/api'
import * as media from '../src/pages/media/api'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it.each(['image', 'video'] as const)('%s 菜单主动刷新目录，保留选择和搜索，不刷新任务或提交生成', async kind => {
  const noun = kind === 'image' ? '图片' : '视频'
  const Component = kind === 'image' ? ImageGeneration : VideoGeneration
  const node: Node = { id:'node', type:kind === 'image' ? 'image_generation' : 'video', asset_id:null, text:'合成提示词', x:0, y:0, width:600, height:378, generation:{ ...defaultGenerationSettings(), model:'current-model' } }
  const initial = { configured:true, references_ready:true, models:[{ id:'current-model' }] }
  let finish!: (value: typeof initial) => void
  const pending = new Promise<typeof initial>(resolve => { finish = resolve })
  const api = vi.spyOn(media, 'api').mockImplementation(path => path === `/${kind}-models?refresh=true` ? pending : Promise.resolve(path === `/${kind}-models` ? initial : []))
  const onPatch = vi.fn()
  const onSave = vi.fn()
  render(<Component projectId="project" node={node} onPatch={onPatch} onSave={onSave} />)
  await waitFor(() => expect(screen.getByRole('button', { name:`${noun}生成模型` })).toHaveTextContent('current-model'))
  fireEvent.click(screen.getByRole('button', { name:`${noun}生成模型` }))
  const search = screen.getByRole('textbox', { name:'搜索生成模型' })
  fireEvent.change(search, { target:{ value:'model' } })
  const refresh = screen.getByRole('button', { name:'刷新模型与价格' })
  const taskCalls = api.mock.calls.filter(([path]) => path.includes('-generations')).length
  fireEvent.click(refresh)
  expect(await screen.findByText('正在刷新模型…')).toBeInTheDocument()
  expect(refresh).toBeDisabled()
  expect(screen.getByRole('option', { name:'current-model' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.click(refresh)
  expect(api.mock.calls.filter(([path]) => path === `/${kind}-models?refresh=true`)).toHaveLength(1)
  await act(async () => { finish({ ...initial, models:[{ id:'new-model' }, { id:'current-model' }] }); await pending })
  expect(await screen.findByRole('option', { name:'new-model' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name:'current-model' })).toHaveAttribute('aria-selected', 'true')
  expect(search).toHaveValue('model')
  expect(refresh).toBeEnabled()
  expect(api.mock.calls.filter(([path]) => path.includes('-generations'))).toHaveLength(taskCalls)
  expect(api.mock.calls.every(([, method]) => !method || method === 'GET')).toBe(true)
  expect(onPatch).not.toHaveBeenCalled()
  expect(onSave).not.toHaveBeenCalled()
})

it.each(['image', 'video'] as const)('%s 空目录可在菜单重试，刷新失败保留目录并允许再次刷新', async kind => {
  const noun = kind === 'image' ? '图片' : '视频'
  const Component = kind === 'image' ? ImageGeneration : VideoGeneration
  const node: Node = { id:'empty', type:kind === 'image' ? 'image_generation' : 'video', asset_id:null, text:'', x:0, y:0, width:600, height:378 }
  let attempt = 0
  const api = vi.spyOn(media, 'api').mockImplementation(path => {
    if (path === `/${kind}-models?refresh=true`) {
      attempt += 1
      return attempt === 2 ? Promise.reject(new Error('目录暂不可用，请重试')) : Promise.resolve({ configured:true, references_ready:true, models:[{ id:'recovered-model' }] })
    }
    return Promise.resolve(path === `/${kind}-models` ? { configured:true, references_ready:true, models:[] } : [])
  })
  render(<Component projectId="project" node={node} onPatch={vi.fn()} onSave={vi.fn()} />)
  await screen.findByText(`暂无可用${noun}模型，可刷新重试。`)
  fireEvent.click(screen.getByRole('button', { name:`${noun}生成模型` }))
  expect(screen.getByText('暂无可用模型，可刷新重试。')).toBeInTheDocument()
  const refresh = screen.getByRole('button', { name:'刷新模型与价格' })
  fireEvent.click(refresh)
  expect(await screen.findByRole('option', { name:'recovered-model' })).toBeInTheDocument()
  await waitFor(() => expect(refresh).toBeEnabled())
  fireEvent.click(refresh)
  expect(await screen.findByRole('alert')).toHaveTextContent('目录暂不可用，请重试')
  expect(screen.getByRole('option', { name:'recovered-model' })).toBeEnabled()
  expect(refresh).toBeEnabled()
  fireEvent.click(refresh)
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  await waitFor(() => expect(refresh).toBeEnabled())
  expect(api.mock.calls.filter(([path]) => path.endsWith('?refresh=true'))).toHaveLength(3)
})
