import { AgentAssistant, type AssistantEditorContext, type AssistantPageContext } from '../../agent/AgentAssistant'

export function BlogAssistant(props: { page: AssistantPageContext; editor: AssistantEditorContext | null; userId?: string; onExecuted?: () => void }) {
  return <AgentAssistant {...props} />
}
