import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiChatRunTerminalError, createAiChatRun, streamAiChatRun } from '../src/lib/api'

function sse(events: object[], newline = '\n') {
  return events.map(event => `data: ${JSON.stringify(event)}${newline}${newline}`).join('')
}

const started = { type: 'RUN_STARTED', threadId: 'conversation', runId: 'run-id' }
const finished = { type: 'RUN_FINISHED', threadId: 'conversation', runId: 'run-id' }
const textStarted = { type: 'TEXT_MESSAGE_START', messageId: 'run-id:assistant', role: 'assistant' }
const textEnded = { type: 'TEXT_MESSAGE_END', messageId: 'run-id:assistant' }
const toolDetails = {
  label: '读取文章', status: 'running', started_at: '2026-10-27T00:00:00Z',
  duration_ms: null, input_summary: '无参数', parameter_names: [], proposal_id: null,
}

describe('AI 可恢复流', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('先应用服务端快照，再追加后续增量', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(sse([
      started,
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'run-id:assistant', role: 'assistant', content: '已经生成' }], metadata: { genesis: { sequence: 3 } } },
      textStarted,
      { type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 3, metrics: null, billing: null, proposals: [] } } },
      { type: 'TOOL_CALL_START', parentMessageId: 'run-id:assistant', toolCallId: 'tool-1', toolCallName: 'list_posts', metadata: { genesis: toolDetails } },
      { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-1', delta: '{}' },
      { type: 'TOOL_CALL_END', toolCallId: 'tool-1' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'tool-1', messageId: 'run-id:tool:tool-1', role: 'tool', content: '返回 2 项结果', metadata: { genesis: { ...toolDetails, status: 'succeeded', duration_ms: 120 } } },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'run-id:assistant', delta: '完成', metadata: { genesis: { sequence: 4 } } },
      { type: 'STATE_SNAPSHOT', snapshot: { genesis: { sequence: 4, billing: null, proposals: [{ proposal_id: 'draft-1' }], metrics: { output_tokens: 20, token_source: 'actual', output_seconds: 2, tokens_per_second: 10, first_token_seconds: 1, total_seconds: 3 } } } },
      textEnded,
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
      onMetrics,
      onProposals,
      onToolCalls,
    })

    expect(result).toBe('completed')
    expect(content).toBe('已经生成完成')
    expect(onProposals).toHaveBeenCalledWith([{ proposal_id: 'draft-1' }])
    expect(onToolCalls).toHaveBeenCalledWith([expect.objectContaining({ id: 'tool-1', status: 'running', result_summary: null })])
    expect(onToolCalls).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'tool-1', status: 'succeeded', result_summary: '返回 2 项结果', duration_ms: 120 })])
    expect(onToolCalls).toHaveBeenCalledTimes(3)
    expect(onToolCalls).toHaveBeenNthCalledWith(1, [])
    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({ token_source: 'actual', tokens_per_second: 10 }))
  })

  it('官方解码器支持跨字节分片、CRLF、心跳和重算后的覆盖快照', async () => {
    const text = ': keep-alive\r\n\r\n' + sse([
      started,
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'run-id:assistant', role: 'assistant', content: '旧正文' }] },
      textStarted, textEnded,
      { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'run-id:assistant', role: 'assistant', content: '新正文' }] },
      textStarted,
      { type: 'TEXT_MESSAGE_START', messageId: 'other', role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'other', delta: '不属于本轮' },
      { type: 'TEXT_MESSAGE_END', messageId: 'other' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'run-id:assistant', delta: '继续' },
      textEnded,
      finished,
    ], '\r\n')
    const bytes = new TextEncoder().encode(text)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
      controller.close()
    } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    let content = ''
    await streamAiChatRun('test-token', 'run-id', {
      onSnapshot: value => { content = value },
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
      onSnapshot: vi.fn(), onBilling,
    })).rejects.toThrow(AiChatRunTerminalError)
    expect(onBilling).toHaveBeenCalledWith({ status: 'pending' })
  })

  it('完整会话快照和正文重算保留工具结果，重连不重复添加调用', async () => {
    const messages = (content: string) => [
      { id: 'previous:user', role: 'user', content: '以前的问题' },
      { id: 'previous:assistant', role: 'assistant', content: '以前的回复' },
      { id: 'run-id:assistant', role: 'assistant', content, toolCalls: [{ id: 'tool-1', type: 'function', function: { name: 'list_posts', arguments: '{}' }, metadata: { genesis: toolDetails } }] },
      { id: 'run-id:tool:tool-1', role: 'tool', toolCallId: 'tool-1', content: '返回 2 项结果', metadata: { genesis: { ...toolDetails, status: 'succeeded', duration_ms: 120 } } },
    ]
    const wire = sse([
      started, { type: 'MESSAGES_SNAPSHOT', messages: messages('已有正文') },
      textStarted, textEnded,
      { type: 'MESSAGES_SNAPSHOT', messages: messages('重算正文') },
      textStarted, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'run-id:assistant', delta: '继续' },
      textEnded, finished,
    ])
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } })))
    for (let attempt = 0; attempt < 2; attempt++) {
      const onSnapshot = vi.fn(), onToolCalls = vi.fn()
      expect(await streamAiChatRun('test-token', 'run-id', { onSnapshot, onToolCalls })).toBe('completed')
      expect(onSnapshot.mock.calls.map(([content]) => String(content))).toEqual(['已有正文', '重算正文', '重算正文继续'])
      expect(onToolCalls).toHaveBeenCalledTimes(1)
      expect(onToolCalls).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'tool-1', status: 'succeeded', duration_ms: 120, result_summary: '返回 2 项结果' })])
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([, init]) => init?.method === 'GET' && !init.body)).toBe(true)
  })

  it('官方顺序校验拒绝非法事件，任务标识不匹配和 HTTP 失败不伪装成断线', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    fetchMock.mockResolvedValueOnce(new Response(sse([
      started, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'run-id:assistant', delta: '缺少开始事件' },
    ]), { headers: { 'Content-Type': 'text/event-stream' } }))
    const handlers = { onSnapshot: vi.fn() }
    await expect(streamAiChatRun('test-token', 'run-id', handlers)).rejects.toThrow('消息流协议校验失败')
    fetchMock.mockResolvedValueOnce(new Response(sse([{ ...started, runId: 'another-run' }]), { headers: { 'Content-Type': 'text/event-stream' } }))
    await expect(streamAiChatRun('test-token', 'run-id', handlers)).rejects.toThrow('消息流任务标识不匹配')
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    await expect(streamAiChatRun('test-token', 'run-id', handlers)).rejects.toThrow('AI 续传失败：HTTP 403')
    expect(handlers.onSnapshot).not.toHaveBeenCalled()
  })

  it('保留官方多轮消息 ID，工具可先于正文出现，快照不丢失业务澄清', async () => {
    const metadata = { genesis: { run_id: 'run-id' } }
    const callMetadata = { genesis: { ...toolDetails, run_id: 'run-id' } }
    const onSnapshot = vi.fn(), onToolCalls = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(sse([
      started,
      { type: 'TOOL_CALL_START', parentMessageId: 'native-tool-message', toolCallId: 'native-call', toolCallName: 'list_posts', metadata: callMetadata },
      { type: 'TOOL_CALL_END', toolCallId: 'native-call' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'native-call', messageId: 'native-result', role: 'tool', content: '安全摘要', metadata: { genesis: { ...toolDetails, run_id: 'run-id', status: 'succeeded' } } },
      { type: 'TEXT_MESSAGE_START', messageId: 'native-answer-1', role: 'assistant', metadata },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'native-answer-1', delta: '第一句。', metadata },
      { type: 'TEXT_MESSAGE_END', messageId: 'native-answer-1' },
      { type: 'TEXT_MESSAGE_START', messageId: 'native-answer-2', role: 'assistant', metadata },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'native-answer-2', delta: '第二句。', metadata },
      { type: 'TEXT_MESSAGE_END', messageId: 'native-answer-2' },
      { type: 'CUSTOM', name: 'genesis.question', value: { content: '业务澄清内容' } },
      { type: 'MESSAGES_SNAPSHOT', messages: [
        { id: 'previous-answer', role: 'assistant', content: '历史回答不应进入本轮' },
        { id: 'native-tool-message', role: 'assistant', content: '', metadata, toolCalls: [{ id: 'native-call', type: 'function', function: { name: 'list_posts', arguments: '{}' }, metadata: callMetadata }] },
        { id: 'native-result', role: 'tool', toolCallId: 'native-call', content: '安全摘要', metadata: { genesis: { ...toolDetails, status: 'succeeded' } } },
        { id: 'native-answer-1', role: 'assistant', content: '第一句。', metadata },
        { id: 'native-answer-2', role: 'assistant', content: '第二句。', metadata },
      ] },
      finished,
    ]), { headers: { 'Content-Type': 'text/event-stream' } }))
    expect(await streamAiChatRun('test-token', 'run-id', { onSnapshot, onToolCalls })).toBe('completed')
    expect(onSnapshot).toHaveBeenLastCalledWith('第一句。第二句。业务澄清内容', expect.any(Number))
    expect(onToolCalls).toHaveBeenCalledWith([expect.objectContaining({ id: 'native-call', status: 'running' })])
    expect(onToolCalls).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'native-call', status: 'succeeded', result_summary: '安全摘要' })])
  })

  it('无终态的断线允许重连，结束事件立即释放未关闭的订阅', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(sse([started]), { headers: { 'Content-Type': 'text/event-stream' } }))
    const handlers = { onSnapshot: vi.fn() }
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
    const result = streamAiChatRun('test-token', 'run-id', { onSnapshot: vi.fn() }, controller.signal)
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    controller.abort()
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.method).not.toBe('DELETE')
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
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
