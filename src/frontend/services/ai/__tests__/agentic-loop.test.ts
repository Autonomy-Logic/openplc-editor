/**
 * The agentic loop, driven by a scripted transport.
 *
 * Everything the loop reaches for is injected — the chat stream comes off a fake
 * `AIPort`, the tool runner is an option — so nothing here mocks a module. That
 * is deliberate: this file runs under jest in the editor and vitest on the web,
 * and module-mock hoisting is the one thing those two do not agree on.
 */

import { beforeEach, describe, expect, it } from '@jest/globals'

import { AIRequestError, type AIPort, type AISSEEvent } from '../../../../middleware/shared/ports/ai-port'
import { openPLCStoreBase } from '../../../store'
import { type AgenticEvent, runAgenticLoop } from '../agentic-loop'
import type { ToolResult } from '../tools'
import type { AIChatRequest, AIToolDefinition } from '../types'

type ChatStream = (params: AIChatRequest, signal?: AbortSignal) => AsyncGenerator<AISSEEvent, void, unknown>

/** Requests the fake port saw, in order, so a test can assert what was sent. */
let sentRequests: AIChatRequest[] = []
/** One stream implementation per iteration; the last one repeats. */
let streams: ChatStream[] = []

/**
 * A port that answers chat and nothing else. Every other method throws rather
 * than returning a benign default — the loop must not be quietly reaching for
 * credits or telemetry while it streams.
 */
function makePort(): AIPort {
  const unreachable = () => {
    throw new Error('the agentic loop must not call this')
  }
  return {
    isFeatureEnabled: true,
    hasUserConsented: true,
    inlineCompletionsEnabled: true,
    streamCompletion: unreachable,
    streamChat: unreachable,
    streamChatEvents(params, signal) {
      sentRequests.push(params)
      const stream = streams[Math.min(sentRequests.length - 1, streams.length - 1)]
      return stream(params, signal)
    },
    fetchEntitlements: unreachable,
    fetchUsage: unreachable,
    fetchCredits: unreachable,
    sendTelemetry: unreachable,
  }
}

async function collect(gen: AsyncGenerator<AgenticEvent, void, unknown>): Promise<AgenticEvent[]> {
  const events: AgenticEvent[] = []
  for await (const event of gen) events.push(event)
  return events
}

function makeStream(events: AISSEEvent[]): ChatStream {
  return async function* () {
    for (const event of events) yield event
  }
}

/** Every tool call succeeds with a fixed message. */
function toolAlways(result: ToolResult) {
  return () => Promise.resolve(result)
}

const baseRequest: AIChatRequest = {
  messages: [{ role: 'user', content: 'hello' }],
  language: 'st',
  model: 'sonnet',
}
const noTools: AIToolDefinition[] = []

describe('runAgenticLoop', () => {
  let port: AIPort

  beforeEach(() => {
    sentRequests = []
    streams = []
    port = makePort()
    openPLCStoreBase.getState().aiActions.setConversationId(null)
  })

  it('forwards conversation_started from the stream', async () => {
    streams = [
      makeStream([
        { type: 'conversation_started', conversationId: 'c1', conversationTitle: 'My title' },
        { type: 'content_block_delta', delta: 'Hi' },
        { type: 'message_stop', stopReason: 'end_turn' },
      ]),
    ]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))

    expect(events[0]).toEqual({
      type: 'conversation_started',
      conversationId: 'c1',
      conversationTitle: 'My title',
    })
  })

  it('emits text_delta per delta and iteration_assistant_complete + done on text-only message_stop', async () => {
    streams = [
      makeStream([
        { type: 'content_block_delta', delta: 'Hello ' },
        { type: 'content_block_delta', delta: 'world' },
        { type: 'message_stop', stopReason: 'end_turn' },
      ]),
    ]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))

    expect(events).toEqual([
      { type: 'text_delta', text: 'Hello ' },
      { type: 'text_delta', text: 'world' },
      { type: 'iteration_assistant_complete', blocks: [{ type: 'text', text: 'Hello world' }] },
      { type: 'done' },
    ])
  })

  it('omits iteration_assistant_complete when message_stop fires with no accumulated text', async () => {
    streams = [makeStream([{ type: 'message_stop', stopReason: 'end_turn' }])]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))

    expect(events).toEqual([{ type: 'done' }])
  })

  it('attaches the slice conversationId to every iteration after conversation_started', async () => {
    // Regression for the chat-split bug: when iter 1 spawns a new
    // conversation (panel writes the id into the slice as it handles the
    // `conversation_started` event), iter 2 must attach the id so the
    // tool-result turn lands on the SAME conversation instead of creating
    // a sibling.
    streams = [
      makeStream([
        { type: 'conversation_started', conversationId: 'conv-A', conversationTitle: 'Treadmill' },
        { type: 'content_block_delta', delta: 'Creating...' },
        { type: 'tool_use', id: 't1', name: 'create_pou', input: {} },
        { type: 'message_stop', stopReason: 'tool_use' },
      ]),
      makeStream([
        { type: 'content_block_delta', delta: 'Done.' },
        { type: 'message_stop', stopReason: 'end_turn' },
      ]),
    ]

    // Stand in for the panel: drive the generator manually so we can write
    // the slice on `conversation_started` BEFORE iter 2 builds its request.
    const gen = runAgenticLoop(port, { ...baseRequest }, noTools, {
      runTool: toolAlways({ success: true, message: 'created' }),
    })
    for await (const event of gen) {
      if (event.type === 'conversation_started') {
        openPLCStoreBase.getState().aiActions.setConversationId(event.conversationId)
      }
    }

    expect(sentRequests).toHaveLength(2)
    expect(sentRequests[0].conversationId).toBeUndefined()
    expect(sentRequests[1].conversationId).toBe('conv-A')
  })

  it('runs a tool, emits tool lifecycle events, and chains a second iteration', async () => {
    streams = [
      makeStream([
        { type: 'content_block_delta', delta: 'Creating Foo...' },
        { type: 'tool_use', id: 'toolu_1', name: 'create_pou', input: { name: 'Foo' } },
        { type: 'message_stop', stopReason: 'tool_use' },
      ]),
      makeStream([
        { type: 'content_block_delta', delta: 'Done.' },
        { type: 'message_stop', stopReason: 'end_turn' },
      ]),
    ]

    const events = await collect(
      runAgenticLoop(port, baseRequest, noTools, { runTool: toolAlways({ success: true, message: 'Foo created' }) }),
    )

    expect(events).toContainEqual({
      type: 'iteration_assistant_complete',
      blocks: [
        { type: 'text', text: 'Creating Foo...' },
        { type: 'tool_use', id: 'toolu_1', name: 'create_pou', input: { name: 'Foo' } },
      ],
    })
    expect(events).toContainEqual({ type: 'tool_call_start', toolId: 'toolu_1', toolName: 'create_pou' })
    expect(events).toContainEqual({
      type: 'tool_call_complete',
      toolId: 'toolu_1',
      toolName: 'create_pou',
      result: { success: true, message: 'Foo created' },
    })
    expect(events).toContainEqual({
      type: 'iteration_tool_results_complete',
      blocks: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Foo created', is_error: false }],
    })

    // Second iteration's text answer + done.
    expect(events.at(-2)).toEqual({
      type: 'iteration_assistant_complete',
      blocks: [{ type: 'text', text: 'Done.' }],
    })
    expect(events.at(-1)).toEqual({ type: 'done' })

    // Second call's request must include the prior assistant + tool_result.
    expect(sentRequests).toHaveLength(2)
    expect(sentRequests[1].messages).toHaveLength(3)
    expect(sentRequests[1].messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Foo created', is_error: false }],
    })
  })

  it('offers the tool definitions it was given to the model', async () => {
    const tools: AIToolDefinition[] = [{ name: 'create_pou', description: 'Create a POU', input_schema: {} }]
    streams = [makeStream([{ type: 'message_stop', stopReason: 'end_turn' }])]

    await collect(runAgenticLoop(port, baseRequest, tools))

    expect(sentRequests[0].tools).toEqual(tools)
  })

  it('marks tool_result with is_error: true when the tool fails', async () => {
    streams = [
      makeStream([
        { type: 'tool_use', id: 'toolu_x', name: 'create_pou', input: {} },
        { type: 'message_stop', stopReason: 'tool_use' },
      ]),
      makeStream([{ type: 'message_stop', stopReason: 'end_turn' }]),
    ]

    const events = await collect(
      runAgenticLoop(port, baseRequest, noTools, {
        runTool: toolAlways({ success: false, message: 'POU name required' }),
      }),
    )

    const toolResultsEvent = events.find((e) => e.type === 'iteration_tool_results_complete')
    expect(toolResultsEvent).toBeDefined()
    expect(toolResultsEvent?.type === 'iteration_tool_results_complete' && toolResultsEvent.blocks[0]).toMatchObject({
      type: 'tool_result',
      is_error: true,
      content: 'POU name required',
    })
  })

  it('yields error event and stops when the stream throws', async () => {
    streams = [
      async function* () {
        yield { type: 'content_block_delta', delta: 'partial' }
        throw new Error('upstream failure')
      },
    ]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))

    expect(events).toContainEqual({ type: 'text_delta', text: 'partial' })
    expect(events.at(-1)).toEqual({ type: 'error', error: 'upstream failure' })
    expect(events.find((e) => e.type === 'done')).toBeUndefined()
  })

  it('forwards AIRequestError.billing through the error event so the modal can pop', async () => {
    const billing = {
      code: 'insufficient_acu' as const,
      message: 'Out of ACU',
      remaining: 0,
      required: 12,
      monthlyLimit: 613,
    }
    const err = new AIRequestError('Out of ACU', 402, undefined, billing)
    streams = [
      async function* () {
        // Cover the "throw before yielding any usable content" path so the
        // catch wraps the AIRequestError into an error event.
        yield { type: 'content_block_delta', delta: '' }
        throw err
      },
    ]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))
    const errorEvent = events.find((e) => e.type === 'error')
    expect(errorEvent).toEqual({ type: 'error', error: 'Out of ACU', billing })
  })

  it('falls back to a generic message when the stream throws a non-Error', async () => {
    streams = [
      // eslint-disable-next-line @typescript-eslint/require-await
      async function* () {
        // Yield nothing, then throw a string (covers the non-Error branch).
        yield { type: 'content_block_delta', delta: '' }
        throw 'oops'
      },
    ]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))

    expect(events.at(-1)).toEqual({ type: 'error', error: 'Stream error' })
  })

  it('returns immediately when the abort signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    streams = [makeStream([{ type: 'message_stop', stopReason: 'end_turn' }])]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools, { signal: controller.signal }))

    expect(events).toEqual([])
    expect(sentRequests).toHaveLength(0)
  })

  it('honors abort signal mid-stream', async () => {
    const controller = new AbortController()
    streams = [
      // eslint-disable-next-line @typescript-eslint/require-await
      async function* () {
        yield { type: 'content_block_delta', delta: 'first' }
        controller.abort()
        yield { type: 'content_block_delta', delta: 'second' }
        yield { type: 'message_stop', stopReason: 'end_turn' }
      },
    ]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools, { signal: controller.signal }))

    expect(events).toEqual([{ type: 'text_delta', text: 'first' }])
  })

  it('emits iteration_assistant_complete + done when the stream ends without a message_stop (text accumulated)', async () => {
    // Stream finishes naturally without ever yielding `message_stop` —
    // exercises the post-for-await `if (toolCalls.length === 0)` branch.
    streams = [makeStream([{ type: 'content_block_delta', delta: 'orphaned' }])]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))

    expect(events).toEqual([
      { type: 'text_delta', text: 'orphaned' },
      { type: 'iteration_assistant_complete', blocks: [{ type: 'text', text: 'orphaned' }] },
      { type: 'done' },
    ])
  })

  it('emits done with no assistant block when the stream ends with no events at all', async () => {
    streams = [makeStream([])]

    const events = await collect(runAgenticLoop(port, baseRequest, noTools))

    expect(events).toEqual([{ type: 'done' }])
  })
})
