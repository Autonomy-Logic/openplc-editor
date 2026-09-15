import type { AIChatContentBlock, ChatMessage } from '../../../../../middleware/shared/ports/types'

/** A `tool_use` block paired with its later `tool_result`; `pending` until the result arrives. */
export type ToolCall = {
  id: string
  name: string
  input: unknown
  status: 'pending' | 'success' | 'error'
  resultContent?: string
}

/** One conversational turn; consecutive assistant messages collapse into a single turn. */
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

/** Collapses store messages into turns; tool_result-only user messages fold into the preceding assistant turn. */
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
