import type { AIChatContentBlock, ChatMessage } from '../../../../../middleware/shared/ports/types'

/**
 * A single tool invocation as seen by the UI: the assistant's `tool_use`
 * block paired with the matching `tool_result` (which lives on a later
 * user-role message). Status is `pending` until the result arrives.
 */
export type ToolCall = {
  id: string
  name: string
  input: unknown
  status: 'pending' | 'success' | 'error'
  resultContent?: string
}

/**
 * A single conversational turn as seen by the user. Multiple store messages
 * (produced one-per-iteration by the agentic loop) collapse into one
 * assistant turn so we don't render a separate bubble per tool call.
 */
export type ChatTurn =
  | { kind: 'user'; message: ChatMessage }
  | {
      kind: 'assistant'
      id: string
      messages: ChatMessage[]
      toolCalls: ToolCall[]
      isStreaming: boolean
    }

function isToolResultOnlyUserMessage(message: ChatMessage): boolean {
  if (message.role !== 'user') return false
  if (typeof message.content === 'string') return false
  if (message.content.length === 0) return false
  return message.content.every((b: AIChatContentBlock) => b.type === 'tool_result')
}

function extractToolUses(content: ChatMessage['content']): Array<Extract<AIChatContentBlock, { type: 'tool_use' }>> {
  if (typeof content === 'string') return []
  return content.filter((b): b is Extract<AIChatContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
}

/**
 * Collapse the raw store list into conversational turns. Consecutive
 * assistant messages — one per agentic-loop iteration — are merged into a
 * single turn so the UI shows one bubble per back-and-forth, regardless of
 * how many HTTP requests the model made under the hood.
 *
 * Tool_result-only user messages are folded into the preceding assistant
 * turn so the renderer can show status (success/error) per tool call.
 */
export function groupMessagesIntoTurns(messages: ChatMessage[], streamingId: string | null): ChatTurn[] {
  const turns: ChatTurn[] = []
  for (const msg of messages) {
    if (isToolResultOnlyUserMessage(msg)) {
      const last = turns[turns.length - 1]
      if (last && last.kind === 'assistant' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type !== 'tool_result') continue
          const call = last.toolCalls.find((c) => c.id === block.tool_use_id)
          if (!call) continue
          call.status = block.is_error ? 'error' : 'success'
          call.resultContent = block.content
        }
      }
      continue
    }

    if (msg.role === 'user') {
      turns.push({ kind: 'user', message: msg })
      continue
    }

    const newCalls: ToolCall[] = extractToolUses(msg.content).map((tu) => ({
      id: tu.id,
      name: tu.name,
      input: tu.input,
      status: 'pending',
    }))

    const last = turns[turns.length - 1]
    if (last && last.kind === 'assistant') {
      last.messages.push(msg)
      last.toolCalls.push(...newCalls)
      if (msg.id === streamingId) last.isStreaming = true
    } else {
      turns.push({
        kind: 'assistant',
        id: msg.id,
        messages: [msg],
        toolCalls: newCalls,
        isStreaming: msg.id === streamingId,
      })
    }
  }
  return turns
}
