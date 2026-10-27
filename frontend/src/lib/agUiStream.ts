import { AGUIError, HttpAgent, type HttpAgentConfig, type Message } from '@ag-ui/client'

import type { AiActionProposal, AiGenerationMetrics, AiToolCall } from './api'
import type { BillingOperation } from '../features/billing/api'

export class AiChatRunTerminalError extends Error {}

export interface AiRunStreamHandlers {
  onBilling?: (billing: BillingOperation | null) => void
  onSnapshot: (content: string, sequence: number) => void
  onMetrics?: (metrics: AiGenerationMetrics | null) => void
  onProposals?: (proposals: AiActionProposal[]) => void
  onToolCalls?: (calls: AiToolCall[]) => void
}

interface GenesisRunState {
  sequence: number
  billing: BillingOperation | null
  metrics: AiGenerationMetrics | null
  proposals: AiActionProposal[]
}

/** 仅适配订阅请求；后台创建、取消和恢复继续由业务 API 管理。 */
class RunSubscriptionAgent extends HttpAgent {
  protected override requestInit(): RequestInit {
    return {
      method: 'GET', headers: { ...this.headers, Accept: 'text/event-stream' },
      signal: this.abortController.signal,
    }
  }
}

/** 当前官方解码器按 LF 分帧；此处只规范化换行，不解析 SSE 或协议事件。 */
function normalizeSseResponse(response: Response, signal: AbortSignal): Response {
  let trailingCr = false
  const body = response.body!
    .pipeThrough(new TextDecoderStream(), { signal })
    .pipeThrough(new TransformStream<string, string>({
      transform(chunk, controller) {
        const text = (trailingCr ? '\r' : '') + chunk
        trailingCr = text.endsWith('\r')
        controller.enqueue((trailingCr ? text.slice(0, -1) : text).replace(/\r\n?/g, '\n'))
      },
      flush(controller) { if (trailingCr) controller.enqueue('\n') },
    }))
    .pipeThrough(new TextEncoderStream())
  return new Response(body, { status: response.status, headers: response.headers })
}

/** 工具生命周期来自官方消息状态，metadata 只补充中文展示与业务关联。 */
function toolPresentation(messages: ReadonlyArray<Readonly<Message>>, messageId: string): AiToolCall[] {
  const assistant = messages.find(message => message.id === messageId)
  if (assistant?.role !== 'assistant') return []
  return (assistant.toolCalls ?? []).map(call => {
    const result = messages.find(message => message.role === 'tool' && message.toolCallId === call.id)
    const details = { ...call.metadata?.genesis, ...result?.metadata?.genesis } as Omit<AiToolCall, 'id' | 'name' | 'result_summary'>
    return {
      ...details, id: call.id, name: call.function.name,
      result_summary: typeof result?.content === 'string' ? result.content : null,
    }
  })
}

/** 复用官方解码、事件顺序校验与消息归并，只保留业务回调和订阅生命周期。 */
export async function consumeAgUiStream(
  config: HttpAgentConfig & Required<Pick<HttpAgentConfig, 'fetch'>>,
  runId: string,
  handlers: AiRunStreamHandlers,
  signal?: AbortSignal,
): Promise<'completed' | 'disconnected'> {
  if (signal?.aborted) throw new DOMException('消息订阅已停止', 'AbortError')
  const controller = new AbortController()
  const agent = new RunSubscriptionAgent({
    ...config,
    fetch: async (url, init) => normalizeSseResponse(await config.fetch(url, init), controller.signal),
  })
  let completed = false
  let terminalError: AiChatRunTerminalError | undefined
  let lastContent: string | undefined
  let lastTools: string | undefined
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    await agent.runAgent({ runId, abortController: controller }, {
      onRunStartedEvent: ({ event }) => {
        if (event.runId !== runId) {
          terminalError = new AiChatRunTerminalError('消息流任务标识不匹配')
          abort()
        }
      },
      onMessagesChanged: ({ messages, state }) => {
        if (terminalError || signal?.aborted) return
        const message = messages.find(item => item.id === `${runId}:assistant`)
        const content = typeof message?.content === 'string' ? message.content : ''
        if (content !== lastContent) {
          lastContent = content
          const sequence = (state.genesis as GenesisRunState | undefined)?.sequence ?? 0
          handlers.onSnapshot(content, sequence)
        }
        const tools = toolPresentation(messages, `${runId}:assistant`)
        const signature = JSON.stringify(tools)
        if (signature !== lastTools) {
          lastTools = signature
          handlers.onToolCalls?.(tools)
        }
      },
      onStateChanged: ({ state }) => {
        if (terminalError || signal?.aborted) return
        const genesis = state.genesis as GenesisRunState | undefined
        if (!genesis) return
        handlers.onMetrics?.(genesis.metrics)
        handlers.onBilling?.(genesis.billing)
        handlers.onProposals?.(genesis.proposals)
      },
      onRunErrorEvent: ({ event }) => {
        if (completed || terminalError || signal?.aborted) return
        terminalError = new AiChatRunTerminalError(event.message)
        abort()
      },
      onRunFinishedEvent: ({ event }) => {
        if (event.runId !== runId) terminalError = new AiChatRunTerminalError('消息流任务标识不匹配')
        else if (!terminalError) completed = true
        abort()
      },
    })
  } catch (error) {
    if (!completed && !terminalError && !signal?.aborted) {
      if (error instanceof AGUIError) throw new AiChatRunTerminalError('消息流协议校验失败，请重新发起对话')
      throw error
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    // 官方客户端负责消息状态；关闭传输只释放订阅，不取消后台任务。
    abort()
  }
  if (signal?.aborted) throw new DOMException('消息订阅已停止', 'AbortError')
  if (terminalError) throw terminalError
  return completed ? 'completed' : 'disconnected'
}
