import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiChatRunTerminalError, createAiChatRun, streamAiChatRun } from '../src/lib/api'

function sse(events: object[], newline = '\n') {
  return events.map(event => `data: ${JSON.stringify(event)}${newline}${newline}`).join('')
}

const started = { type: 'RUN_STARTED', threadId: 'conversation', runId: 'run-id' }
const finished = { type: 'RUN_FINISHED', threadId: 'conversation', runId: 'run-id' }

describe('AI 可恢复流', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('先应用服务端快照，再追加后续增量', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(sse([
      started,
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'run-id:assistant', role: 'assistant', content: '已经生成' }], metadata: { genesis: { sequence: 3 } } },
      { type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 3, metrics: null, billing: null, proposals: [], tool_calls: [] } } },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'run-id:assistant', delta: '完成', metadata: { genesis: { sequence: 4 } } },
      { type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 4, billing: null, proposals: [{ proposal_id: 'draft-1' }], tool_calls: [{ id: 'tool-1', status: 'succeeded' }], metrics: { output_tokens: 20, token_source: 'actual', output_seconds: 2, tokens_per_second: 10, first_token_seconds: 1, total_seconds: 3 } } } },
      finished,
    ]), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    let content = ''
    const onMetrics = vi.fn()
    const onProposals = vi.fn()
    const onToolCalls = vi.fn()
    const result = await streamAiChatRun('test-token', 'run-id', {
      onSnapshot: (snapshot) => { content = snapshot },
      onToken: (token) => { content += token },
      onMetrics,
      onProposals,
      onToolCalls,
    })

    expect(result).toBe('completed')
    expect(content).toBe('已经生成完成')
    expect(onProposals).toHaveBeenCalledWith([{ proposal_id: 'draft-1' }])
    expect(onToolCalls).toHaveBeenCalledWith([{ id: 'tool-1', status: 'succeeded' }])
    expect(onToolCalls).toHaveBeenNthCalledWith(1, [])
    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({ token_source: 'actual', tokens_per_second: 10 }))
  })

  it('官方解码器支持跨字节分片、CRLF、心跳和重算后的覆盖快照', async () => {
    const text = ': keep-alive\r\n\r\n' + sse([
      started,
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'run-id:assistant', role: 'assistant', content: '旧正文' }] },
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'run-id:assistant', role: 'assistant', content: '新正文' }] },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'other', delta: '不属于本轮' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'run-id:assistant', delta: '继续' },
      finished,
    ], '\r\n')
    const bytes = new TextEncoder().encode(text)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
      controller.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    let content = ''
    await streamAiChatRun('test-token', 'run-id', {
      onSnapshot: value => { content = value }, onToken: value => { content += value },
    })
    expect(content).toBe('新正文继续')
  })

  it('终态业务更新先落到界面，再报告运行失败', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(sse([
      started,
      { type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 2, billing: { status: 'pending' }, metrics: null, proposals: [], tool_calls: [] } } },
      { type: 'RUN_ERROR', message: '生成已由用户停止。' },
    ]), { headers: { 'Content-Type': 'text/event-stream' } }))
    const onBilling = vi.fn()
    await expect(streamAiChatRun('test-token', 'run-id', {
      onSnapshot: vi.fn(), onToken: vi.fn(), onBilling,
    })).rejects.toThrow(AiChatRunTerminalError)
    expect(onBilling).toHaveBeenCalledWith({ status: 'pending' })
  })

  it('无终态的断线允许重连，结束事件立即释放未关闭的订阅', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(sse([started]), { headers: { 'Content-Type': 'text/event-stream' } }))
    const handlers = { onSnapshot: vi.fn(), onToken: vi.fn() }
    expect(await streamAiChatRun('test-token', 'run-id', handlers)).toBe('disconnected')
    const cancel = vi.fn()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode(sse([started, finished]))) }, cancel,
    }), { headers: { 'Content-Type': 'text/event-stream' } }))
    expect(await streamAiChatRun('test-token', 'run-id', handlers)).toBe('completed')
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled())
  })

  it('离开页面仅中止订阅，不调用后台取消接口', async () => {
    const cancel = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'text/event-stream' } }))
    const controller = new AbortController()
    const result = streamAiChatRun('test-token', 'run-id', { onSnapshot: vi.fn(), onToken: vi.fn() }, controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    controller.abort()
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).not.toBe('DELETE')
  })
  it('展示 FastAPI 的请求校验详情', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      detail: [{ loc: ['body', 'messages', 0, 'content'], msg: 'String should have at least 1 character' }],
    }), {
      status: 422,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(createAiChatRun('test-token', {
      surface: 'studio',
      messages: [{ role: 'user', content: '测试' }],
    })).rejects.toThrow('请求失败：HTTP 422（body.messages.0.content：String should have at least 1 character）')
  })

})
