/**
 * Narrowing for a stored transcript.
 *
 * `AIConversationDetail` keeps a message's `content` as `unknown` on purpose:
 * the block shape belongs to the wire, and restating it on the port would be a
 * second copy of something the server owns. That opacity stops at this boundary
 * — the store holds `string | AIChatContentBlock[]`, so anything arriving from
 * the transport is checked here rather than asserted into place.
 *
 * A block we do not recognise is DROPPED, not coerced. A transcript written by a
 * newer backend then renders as the parts this build understands instead of
 * putting an object where the renderer expects text.
 */

import type { AIChatContentBlock } from '../../../../middleware/shared/ports/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toContentBlock(value: unknown): AIChatContentBlock | null {
  if (!isRecord(value)) return null

  if (value.type === 'text' && typeof value.text === 'string') {
    return { type: 'text', text: value.text }
  }

  if (value.type === 'tool_use' && typeof value.id === 'string' && typeof value.name === 'string') {
    return { type: 'tool_use', id: value.id, name: value.name, input: value.input }
  }

  if (value.type === 'tool_result' && typeof value.tool_use_id === 'string') {
    return {
      type: 'tool_result',
      tool_use_id: value.tool_use_id,
      content: typeof value.content === 'string' ? value.content : '',
      ...(typeof value.is_error === 'boolean' ? { is_error: value.is_error } : {}),
    }
  }

  return null
}

/**
 * Turn a transcript message's opaque `content` into what the store accepts.
 * Plain prose stays a string; a block array keeps only the blocks this build
 * knows. Anything else becomes an empty string, which renders as a blank turn
 * rather than throwing inside the message renderer.
 */
export function toChatMessageContent(value: unknown): string | AIChatContentBlock[] {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  const blocks: AIChatContentBlock[] = []
  for (const entry of value) {
    const block = toContentBlock(entry)
    if (block) blocks.push(block)
  }
  return blocks
}
