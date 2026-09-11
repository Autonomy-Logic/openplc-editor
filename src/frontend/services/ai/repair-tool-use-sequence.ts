import type { AIChatContentBlock, AIChatMessage } from './types'

/**
 * Content for a synthesized `tool_result` that closes a `tool_use` whose real
 * result was never recorded (the agentic loop was interrupted between the
 * assistant turn and the follow-up request that would have carried it).
 */
export const INTERRUPTED_TOOL_RESULT_CONTENT =
  'The previous tool call did not complete — the session was interrupted before a result was recorded. ' +
  'Treat it as not executed and retry if needed.'

function isBlockArray(content: AIChatMessage['content']): content is AIChatContentBlock[] {
  return Array.isArray(content)
}

function isToolUse(block: AIChatContentBlock): block is Extract<AIChatContentBlock, { type: 'tool_use' }> {
  return block.type === 'tool_use'
}

function isToolResult(block: AIChatContentBlock): block is Extract<AIChatContentBlock, { type: 'tool_result' }> {
  return block.type === 'tool_result'
}

function isEmptyText(block: AIChatContentBlock): boolean {
  return block.type === 'text' && (typeof block.text !== 'string' || block.text.trim() === '')
}

function makeToolResult(toolUseId: string): AIChatContentBlock {
  return { type: 'tool_result', tool_use_id: toolUseId, content: INTERRUPTED_TOOL_RESULT_CONTENT, is_error: true }
}

function stripEmptyText(blocks: AIChatContentBlock[]): AIChatContentBlock[] {
  return blocks.filter((b) => !isEmptyText(b))
}

/**
 * Client-side mirror of the backend repair. Make a message list valid for the
 * Anthropic Messages API before sending it, so an interrupted agentic loop can
 * never leave the conversation unresumable.
 *
 * The API requires every assistant `tool_use` to be answered by a matching
 * `tool_result` in the immediately following user message, and rejects orphan
 * `tool_result`s and empty `text` blocks. A loop persists the `tool_use` turn
 * and its `tool_result` turn in two separate requests, so an interruption
 * between them strands a `tool_use` with no result and every later request
 * 400s. This:
 *  - synthesizes an `is_error` `tool_result` for each unanswered `tool_use`
 *    (merged into the following user message, or inserted as a new one),
 *  - drops orphan `tool_result`s and empty text blocks.
 *
 * The backend applies the same repair; this guard means a stale client build
 * still can't send a broken sequence.
 */
export function repairToolUseSequence(messages: AIChatMessage[]): AIChatMessage[] {
  const out: AIChatMessage[] = []
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]

    if (msg.role === 'assistant' && isBlockArray(msg.content)) {
      const blocks = stripEmptyText(msg.content)
      out.push({ ...msg, content: blocks })

      const toolUseIds = blocks.filter(isToolUse).map((b) => b.id)
      if (toolUseIds.length > 0) {
        const next = messages[i + 1]

        if (next && next.role === 'user' && isBlockArray(next.content)) {
          const nextBlocks = stripEmptyText(next.content)
          const answered = new Set(nextBlocks.filter(isToolResult).map((b) => b.tool_use_id))
          const missing = toolUseIds.filter((id) => !answered.has(id))
          const kept = nextBlocks.filter((b) => !isToolResult(b) || toolUseIds.includes(b.tool_use_id))
          out.push({ ...next, content: [...missing.map(makeToolResult), ...kept] })
          i += 2
          continue
        }

        // No user turn follows the tool_use — insert a synthetic one.
        out.push({ role: 'user', content: toolUseIds.map(makeToolResult) })
        i += 1
        continue
      }

      i += 1
      continue
    }

    if (msg.role === 'user' && isBlockArray(msg.content)) {
      const prev = out[out.length - 1]
      const prevToolUseIds =
        prev && prev.role === 'assistant' && isBlockArray(prev.content)
          ? prev.content.filter(isToolUse).map((b) => b.id)
          : []
      const blocks = stripEmptyText(msg.content).filter(
        (b) => !isToolResult(b) || prevToolUseIds.includes(b.tool_use_id),
      )
      const safeBlocks: AIChatContentBlock[] = blocks.length > 0 ? blocks : [{ type: 'text', text: '(no content)' }]
      out.push({ ...msg, content: safeBlocks })
      i += 1
      continue
    }

    // String content (plain text) or any other shape — pass through.
    out.push(msg)
    i += 1
  }

  return out
}
