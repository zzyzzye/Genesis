import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App } from '../src/App'

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('展示应用名称和后端连接状态', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'ok', service: 'genesis-api', environment: 'test' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Genesis' })).toBeInTheDocument()
    expect(await screen.findByText('后端服务正常 · test')).toBeInTheDocument()
  })
})
