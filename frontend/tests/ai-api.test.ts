import { afterEach, describe, expect, it, vi } from 'vitest'

import { streamAiChatRun } from '../src/lib/api'

describe('AI 可恢复流', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('先应用服务端快照，再追加后续增量', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response([
      'id: 3',
      'data: {"type":"snapshot","content":"已经生成","sequence":3}',
      '',
      'id: 4',
      'data: {"type":"token","content":"完成","sequence":4}',
      '',
      'data: {"type":"done","sequence":4}',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    let content = ''
    const result = await streamAiChatRun('test-token', 'run-id', {
      onSnapshot: (snapshot) => { content = snapshot },
      onToken: (token) => { content += token },
    })

    expect(result).toBe('completed')
    expect(content).toBe('已经生成完成')
  })
})
