import { describe, expect, it } from '@jest/globals'

import type { AIChatContentBlock, AIChatMessage } from '../types'
import { INTERRUPTED_TOOL_RESULT_CONTENT, repairToolUseSequence } from '../repair-tool-use-sequence'

const text = (t: string): AIChatContentBlock => ({ type: 'text', text: t })
const toolUse = (id: string): AIChatContentBlock => ({ type: 'tool_use', id, name: 'create_pou', input: {} })
const toolResult = (id: string): AIChatContentBlock => ({ type: 'tool_result', tool_use_id: id, content: 'ok' })

describe('repairToolUseSequence (frontend guard)', () => {
  it('leaves an already-valid sequence unchanged', () => {
    const messages: AIChatMessage[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [text('hi'), toolUse('t1')] },
      { role: 'user', content: [toolResult('t1')] },
      { role: 'assistant', content: [text('done')] },
    ]

    expect(repairToolUseSequence(messages)).toEqual(messages)
  })

  it('passes string content through untouched', () => {
    const messages: AIChatMessage[] = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
    ]

    expect(repairToolUseSequence(messages)).toEqual(messages)
  })

  it('synthesizes a tool_result when a tool_use turn is followed by plain user text (the prod bug)', () => {
    const messages: AIChatMessage[] = [
      { role: 'user', content: 'create a water level system' },
      { role: 'assistant', content: [text('building'), toolUse('t1')] },
      { role: 'user', content: [text('Continue a implementação')] },
    ]

    const out = repairToolUseSequence(messages)

    expect(out).toHaveLength(3)
    expect(out[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: INTERRUPTED_TOOL_RESULT_CONTENT, is_error: true },
      text('Continue a implementação'),
    ])
  })

  it('inserts a synthetic user message when a tool_use turn is the last message', () => {
    const messages: AIChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [toolUse('t1'), toolUse('t2')] },
    ]

    const out = repairToolUseSequence(messages)

    expect(out).toHaveLength(3)
    expect(out[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: INTERRUPTED_TOOL_RESULT_CONTENT, is_error: true },
        { type: 'tool_result', tool_use_id: 't2', content: INTERRUPTED_TOOL_RESULT_CONTENT, is_error: true },
      ],
    })
  })

  it('inserts a synthetic user message when the next turn is a plain string user message', () => {
    const messages: AIChatMessage[] = [
      { role: 'assistant', content: [toolUse('t1')] },
      { role: 'user', content: 'Ola' },
    ]

    const out = repairToolUseSequence(messages)

    expect(out).toHaveLength(3)
    expect(out[1]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: INTERRUPTED_TOOL_RESULT_CONTENT, is_error: true }],
    })
    expect(out[2]).toEqual({ role: 'user', content: 'Ola' })
  })

  it('fills only the missing tool_results when some are already present', () => {
    const messages: AIChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [toolUse('t1'), toolUse('t2')] },
      { role: 'user', content: [toolResult('t1')] },
    ]

    const out = repairToolUseSequence(messages)
    const blocks = out[2].content as AIChatContentBlock[]

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ tool_use_id: 't2', is_error: true })
    expect(blocks[1]).toEqual(toolResult('t1'))
  })

  it('drops orphan tool_results that have no matching tool_use', () => {
    const messages: AIChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [text('no tools here')] },
      { role: 'user', content: [toolResult('ghost')] },
    ]

    const out = repairToolUseSequence(messages)

    expect(out[2].content).toEqual([{ type: 'text', text: '(no content)' }])
  })

  it('drops empty text blocks', () => {
    const messages: AIChatMessage[] = [{ role: 'assistant', content: [text(''), text('   '), text('real')] }]

    const out = repairToolUseSequence(messages)

    expect(out[0].content).toEqual([text('real')])
  })

  it('is idempotent — repairing twice yields the same result', () => {
    const messages: AIChatMessage[] = [
      { role: 'user', content: 'create' },
      { role: 'assistant', content: [toolUse('t1')] },
      { role: 'user', content: [text('Continue')] },
    ]

    const once = repairToolUseSequence(messages)
    expect(repairToolUseSequence(once)).toEqual(once)
  })
})
