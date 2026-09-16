// Message content arrives as `unknown` from the wire; unrecognised blocks are dropped, not coerced.

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

/** Unrecognised content becomes an empty string. */
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
