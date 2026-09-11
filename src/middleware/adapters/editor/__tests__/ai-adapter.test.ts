/**
 * The editor's AI adapter.
 *
 * Two things here would be invisible in a diff and catastrophic in use, so they get the
 * most attention:
 *
 *   - A frame that arrives while nobody is pulling must still be there when the consumer
 *     comes back. A generator only runs between `next()` calls and the model does not
 *     wait; a transport that dropped what landed in between would lose words out of the
 *     middle of an answer, with nothing anywhere reporting a problem.
 *   - A refusal must arrive as `AIRequestError`, with its `billing` payload whole. IPC
 *     structure-clones its payloads and the prototype does not survive, so the assertions
 *     below are about `instanceof` and about the payload's fields — a test that only
 *     checked the message would still pass while someone out of credits was being shown
 *     a generic error instead of the exhaustion modal.
 *
 * The rest guards the things that are easy to get subtly wrong: abort has to reach the
 * server, every exit path has to unsubscribe, and an answer this build cannot read has to
 * be refused rather than trusted.
 */

import { AIRequestError } from '../../../shared/ports/ai-port'
import type { AISSEEvent } from '../../../shared/ports/ai-port'
import { createEditorAIAdapter } from '../ai-adapter'

type EventPayload = { streamId: string; event: unknown }
type EndPayload = { streamId: string }
type ErrorPayload = { streamId: string; failure: unknown }

/** Every listener the adapter attached, so a leak is visible as a listener left behind. */
const live = {
  event: new Set<(payload: EventPayload) => void>(),
  end: new Set<(payload: EndPayload) => void>(),
  error: new Set<(payload: ErrorPayload) => void>(),
}

type Bridge = Record<string, jest.Mock>

let bridge: Bridge

/** Let every pending microtask (and the generator parked on one) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function installBridge(): Bridge {
  live.event.clear()
  live.end.clear()
  live.error.clear()

  const value: Bridge = {
    edgeAiFetchEntitlements: jest.fn().mockResolvedValue({ ok: true, data: { acu: { monthlyAcu: 100 } } }),
    edgeAiFetchUsage: jest.fn().mockResolvedValue({ ok: true, data: { acu: { used: 4 } } }),
    edgeAiFetchCredits: jest.fn().mockResolvedValue({ ok: true, data: { credits_used: 1, credits_total: 500 } }),
    edgeAiWarm: jest.fn().mockResolvedValue({ ok: true, data: null }),
    edgeAiSendTelemetry: jest.fn().mockResolvedValue({ ok: true, data: null }),
    edgeAiListConversations: jest.fn().mockResolvedValue({ ok: true, data: { conversations: [] } }),
    edgeAiGetConversation: jest.fn(),
    edgeAiCreateConversation: jest.fn(),
    edgeAiRenameConversation: jest.fn(),
    edgeAiDeleteConversation: jest.fn().mockResolvedValue({ ok: true, data: null }),
    edgeAiStreamStart: jest.fn().mockResolvedValue({ ok: true, data: { streamId: 'stream-1' } }),
    edgeAiStreamAbort: jest.fn().mockResolvedValue({ ok: true, data: null }),
    onEdgeAiStreamEvent: jest.fn((callback: (payload: EventPayload) => void) => {
      live.event.add(callback)

      return () => live.event.delete(callback)
    }),
    onEdgeAiStreamEnd: jest.fn((callback: (payload: EndPayload) => void) => {
      live.end.add(callback)

      return () => live.end.delete(callback)
    }),
    onEdgeAiStreamError: jest.fn((callback: (payload: ErrorPayload) => void) => {
      live.error.add(callback)

      return () => live.error.delete(callback)
    }),
  }

  Object.defineProperty(window, 'bridge', { value, writable: true, configurable: true })

  return value
}

const emitEvent = (event: unknown, streamId = 'stream-1') => live.event.forEach((cb) => cb({ streamId, event }))
const emitEnd = (streamId = 'stream-1') => live.end.forEach((cb) => cb({ streamId }))
const emitFailure = (failure: unknown, streamId = 'stream-1') => live.error.forEach((cb) => cb({ streamId, failure }))

const listenerCount = () => live.event.size + live.end.size + live.error.size

const CONFIG = { isFeatureEnabled: true, hasUserConsented: true, inlineCompletionsEnabled: true }

const adapter = () => createEditorAIAdapter(CONFIG)

const delta = (text: string): AISSEEvent => ({ type: 'content_block_delta', delta: text })

beforeEach(() => {
  jest.clearAllMocks()
  bridge = installBridge()
})

describe('the feature config the composition root supplied', () => {
  it('is what the store reads back off the port', () => {
    const ai = createEditorAIAdapter({
      isFeatureEnabled: true,
      hasUserConsented: false,
      inlineCompletionsEnabled: false,
    })

    expect(ai.isFeatureEnabled).toBe(true)
    expect(ai.hasUserConsented).toBe(false)
    expect(ai.inlineCompletionsEnabled).toBe(false)
  })
})

describe('frames that arrive before the consumer pulls', () => {
  it('are queued rather than dropped', async () => {
    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    // Parked on an empty queue at this point, so everything below lands with nobody
    // waiting for it — which is precisely the case that must not lose frames.
    await settle()

    emitEvent(delta('one'))
    emitEvent({ type: 'tool_use', id: 't1', name: 'create_pou', input: { name: 'Main' } })
    emitEvent(delta('two'))
    emitEnd()

    await expect(first).resolves.toEqual({ done: false, value: delta('one') })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'tool_use', id: 't1', name: 'create_pou', input: { name: 'Main' } },
    })
    await expect(iterator.next()).resolves.toEqual({ done: false, value: delta('two') })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('subscribes before the request is opened, so nothing can outrun the id', async () => {
    let attachedWhenOpened = -1

    bridge.edgeAiStreamStart.mockImplementationOnce(() => {
      // The listeners must already be on at the instant the request is opened: `invoke`
      // and the pushed channels are separate IPC messages, and a stream that starts
      // producing on this same tick would otherwise lose its first frames.
      attachedWhenOpened = listenerCount()

      return Promise.resolve({ ok: true, data: { streamId: 'stream-1' } })
    })

    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()
    emitEnd()
    await first

    expect(attachedWhenOpened).toBe(3)
  })

  it('ignores frames belonging to another live stream', async () => {
    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()

    // An inline completion answering at the same time as the chat panel.
    emitEvent(delta('not mine'), 'stream-9')
    emitEnd('stream-9')
    emitEvent(delta('mine'))
    emitEnd()

    await expect(first).resolves.toEqual({ done: false, value: delta('mine') })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  })

  it('drops a frame this build cannot read rather than losing the whole answer', async () => {
    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()

    emitEvent({ type: 'content_block_delta', delta: { not: 'a string' } })
    emitEvent(delta('still here'))
    emitEnd()

    await expect(first).resolves.toEqual({ done: false, value: delta('still here') })
  })

  it('ends on message_stop without waiting for anything else', async () => {
    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()
    emitEvent({ type: 'message_stop', stopReason: 'end_turn' })

    await expect(first).resolves.toEqual({ done: false, value: { type: 'message_stop', stopReason: 'end_turn' } })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(listenerCount()).toBe(0)
  })

  it('carries the conversation id the backend assigned', async () => {
    const iterator = adapter().streamChatEvents({ messages: [], projectId: 'p1' })
    const first = iterator.next()

    await settle()
    emitEvent({ type: 'conversation_started', conversationId: 'c1', conversationTitle: 'Ladder help' })
    emitEnd()

    await expect(first).resolves.toEqual({
      done: false,
      value: { type: 'conversation_started', conversationId: 'c1', conversationTitle: 'Ladder help' },
    })
  })
})

describe('stopping a stream', () => {
  it('tells the server to stop and detaches every listener', async () => {
    const controller = new AbortController()
    const iterator = adapter().streamChatEvents({ messages: [] }, controller.signal)
    const first = iterator.next()

    await settle()
    controller.abort()

    await expect(first).resolves.toEqual({ done: true, value: undefined })
    expect(bridge.edgeAiStreamAbort).toHaveBeenCalledWith('stream-1')
    expect(listenerCount()).toBe(0)
  })

  it('never opens a request that was cancelled before it started', async () => {
    const controller = new AbortController()

    controller.abort()

    const iterator = adapter().streamChatEvents({ messages: [] }, controller.signal)

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(bridge.edgeAiStreamStart).not.toHaveBeenCalled()
    expect(bridge.edgeAiStreamAbort).not.toHaveBeenCalled()
    expect(listenerCount()).toBe(0)
  })

  it('still cancels when the abort landed while the request was being opened', async () => {
    const controller = new AbortController()

    bridge.edgeAiStreamStart.mockImplementationOnce(() => {
      controller.abort()

      return Promise.resolve({ ok: true, data: { streamId: 'stream-1' } })
    })

    const iterator = adapter().streamChatEvents({ messages: [] }, controller.signal)

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    expect(bridge.edgeAiStreamAbort).toHaveBeenCalledWith('stream-1')
    expect(listenerCount()).toBe(0)
  })

  it('cancels and unsubscribes when the caller breaks out of its loop early', async () => {
    const controller = new AbortController()
    const events = adapter().streamChatEvents({ messages: [] }, controller.signal)

    const read = (async () => {
      for await (const event of events) {
        if (event.type === 'content_block_delta') break
      }
    })()

    await settle()
    emitEvent(delta('enough'))
    await read

    expect(bridge.edgeAiStreamAbort).toHaveBeenCalledWith('stream-1')
    expect(listenerCount()).toBe(0)
  })

  it('does not cancel a stream that ended on its own', async () => {
    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()
    emitEnd()

    await expect(first).resolves.toEqual({ done: true, value: undefined })
    expect(bridge.edgeAiStreamAbort).not.toHaveBeenCalled()
  })

  it('survives a main process with no abort channel', async () => {
    const controller = new AbortController()

    delete bridge.edgeAiStreamAbort

    const iterator = adapter().streamChatEvents({ messages: [] }, controller.signal)
    const first = iterator.next()

    await settle()
    controller.abort()

    await expect(first).resolves.toEqual({ done: true, value: undefined })
    expect(listenerCount()).toBe(0)
  })

  it('swallows an abort the main process rejected — the reader is already gone', async () => {
    const controller = new AbortController()

    bridge.edgeAiStreamAbort.mockRejectedValue(new Error('window closed'))

    const iterator = adapter().streamChatEvents({ messages: [] }, controller.signal)
    const first = iterator.next()

    await settle()
    controller.abort()

    await expect(first).resolves.toEqual({ done: true, value: undefined })
    await settle()
  })
})

describe('a refusal becomes the error the shared UI branches on', () => {
  it('rebuilds a billing block with its payload intact', async () => {
    const billing = {
      code: 'insufficient_acu',
      message: 'Out of ACU.',
      remaining: 0,
      required: 12,
      monthlyLimit: 500,
      reactivateUrl: 'https://edge.example/billing',
    }

    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()
    emitFailure({ kind: 'billing', status: 402, message: 'Out of ACU.', billing })

    // `instanceof`, not the message: the prototype is exactly what the structured clone
    // destroys, and it is what the chat panel tests to decide whether to open the
    // exhaustion modal at all.
    await expect(first).rejects.toBeInstanceOf(AIRequestError)
    // Re-run to inspect the payload, since a rejection cannot be read twice.
    await first.catch((error: unknown) => {
      expect(error).toBeInstanceOf(AIRequestError)

      if (error instanceof AIRequestError) {
        expect(error.status).toBe(402)
        expect(error.billing).toEqual(billing)
      }
    })

    expect(listenerCount()).toBe(0)
  })

  it('reads a signed-out failure as 401 rather than as a denial', async () => {
    bridge.edgeAiFetchUsage.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'signed-out', message: 'Sign in to Autonomy Edge to use the assistant.' },
    })

    await expect(adapter().fetchUsage()).rejects.toMatchObject({ status: 401 })
  })

  it('reads an unreachable server as status 0, because nothing was learned', async () => {
    bridge.edgeAiFetchCredits.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'unreachable', message: 'No answer' },
    })

    await expect(adapter().fetchCredits()).rejects.toMatchObject({ status: 0, message: 'No answer' })
  })

  it('keeps an ordinary HTTP status so a 403 reads differently from a 500', async () => {
    bridge.edgeAiFetchEntitlements.mockResolvedValueOnce({
      ok: false,
      failure: { kind: 'http', status: 503, message: 'AI service temporarily unavailable.' },
    })

    await expect(adapter().fetchEntitlements()).rejects.toMatchObject({ status: 503 })
  })

  it('throws on an error frame instead of yielding it, as the web transport does', async () => {
    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()
    emitEvent({ type: 'error', error: 'The model stopped generating.' })

    await expect(first).rejects.toMatchObject({ status: 0, message: 'The model stopped generating.' })
    expect(listenerCount()).toBe(0)
  })
})

describe('an answer this build cannot read', () => {
  it('is refused rather than trusted, envelope and all', async () => {
    bridge.edgeAiFetchUsage.mockResolvedValueOnce(null)

    await expect(adapter().fetchUsage()).rejects.toBeInstanceOf(AIRequestError)
  })

  it('is refused when the failure carries a kind this build has no branch for', async () => {
    bridge.edgeAiFetchUsage.mockResolvedValueOnce({ ok: false, failure: { kind: 'teapot', message: 'nope' } })

    await expect(adapter().fetchUsage()).rejects.toMatchObject({
      message: 'Autonomy Edge returned an answer this build of the editor cannot read.',
    })
  })

  it('is refused when a stream is opened without an id to abort it by', async () => {
    bridge.edgeAiStreamStart.mockResolvedValueOnce({ ok: true, data: { streamId: '' } })

    const iterator = adapter().streamChatEvents({ messages: [] })

    await expect(iterator.next()).rejects.toBeInstanceOf(AIRequestError)
    expect(listenerCount()).toBe(0)
  })

  it('is refused when a reported stream failure is unreadable', async () => {
    const iterator = adapter().streamChatEvents({ messages: [] })
    const first = iterator.next()

    await settle()
    emitFailure({ kind: 'billing', status: 402 })

    await expect(first).rejects.toMatchObject({
      message: 'Autonomy Edge returned an answer this build of the editor cannot read.',
    })
  })

  it('is refused when a conversation arrives in a shape the port cannot promise', async () => {
    bridge.edgeAiGetConversation.mockResolvedValueOnce({ ok: true, data: { conversation: { id: 'c1' } } })

    await expect(adapter().conversations?.get('c1')).rejects.toBeInstanceOf(AIRequestError)
  })
})

describe('a main process that predates this renderer', () => {
  it('reports a missing buffered channel as an ordinary error', async () => {
    delete bridge.edgeAiFetchEntitlements

    await expect(adapter().fetchEntitlements()).rejects.toMatchObject({
      message: expect.stringContaining('edge-ai:entitlements'),
    })
  })

  it('reports missing stream channels without leaving a listener behind', async () => {
    delete bridge.onEdgeAiStreamEnd

    const iterator = adapter().streamChatEvents({ messages: [] })

    await expect(iterator.next()).rejects.toBeInstanceOf(AIRequestError)
    expect(listenerCount()).toBe(0)
  })

  it('lets warm and telemetry be absent, because neither is worth a toast', () => {
    delete bridge.edgeAiWarm
    delete bridge.edgeAiSendTelemetry

    const ai = adapter()

    expect(() => ai.warmCache?.()).not.toThrow()
    expect(() => ai.sendTelemetry('chat_message', {})).not.toThrow()
  })
})

describe('the prose views are derived from the structured one', () => {
  it('yields only the text of a chat answer', async () => {
    const chunks: string[] = []
    const reading = (async () => {
      for await (const text of adapter().streamChat({ messages: [] })) {
        chunks.push(text)
      }
    })()

    await settle()
    emitEvent(delta('Hello'))
    emitEvent({ type: 'tool_use', id: 't1', name: 'read_pou', input: {} })
    emitEvent(delta(' world'))
    emitEnd()
    await reading

    expect(chunks).toEqual(['Hello', ' world'])
  })

  it('yields only the text of a completion, and asks for the completion route', async () => {
    const chunks: string[] = []
    const reading = (async () => {
      for await (const text of adapter().streamCompletion({ prefix: 'a', suffix: 'b', language: 'st' })) {
        chunks.push(text)
      }
    })()

    await settle()
    emitEvent(delta('IF x THEN'))
    emitEnd()
    await reading

    expect(chunks).toEqual(['IF x THEN'])
    expect(bridge.edgeAiStreamStart).toHaveBeenCalledWith({
      kind: 'completion',
      body: { prefix: 'a', suffix: 'b', language: 'st' },
    })
  })
})

describe('fire-and-forget channels', () => {
  it('stamps telemetry with the moment it happened and never rejects', async () => {
    adapter().sendTelemetry('chat_rating', { rating: 'up' })

    expect(bridge.edgeAiSendTelemetry).toHaveBeenCalledWith('chat_rating', {
      rating: 'up',
      timestamp: expect.any(Number),
    })

    bridge.edgeAiSendTelemetry.mockRejectedValueOnce(new Error('offline'))
    adapter().sendTelemetry('chat_message', {})
    await settle()
  })

  it('warms the prompt cache without anyone waiting on it', async () => {
    adapter().warmCache?.()

    expect(bridge.edgeAiWarm).toHaveBeenCalledTimes(1)

    bridge.edgeAiWarm.mockRejectedValueOnce(new Error('offline'))
    adapter().warmCache?.()
    await settle()
  })
})

describe('stored conversations', () => {
  it('lists what the switcher shows', async () => {
    bridge.edgeAiListConversations.mockResolvedValueOnce({
      ok: true,
      data: {
        conversations: [
          { id: 'c1', title: 'Ladder help', updatedAt: '2026-01-02T03:04:05Z', projectId: 'p1', lastModel: 'sonnet' },
        ],
      },
    })

    await expect(adapter().conversations?.list({ projectId: 'p1', limit: 10 })).resolves.toEqual([
      { id: 'c1', title: 'Ladder help', updatedAt: '2026-01-02T03:04:05Z', projectId: 'p1' },
    ])
    expect(bridge.edgeAiListConversations).toHaveBeenCalledWith({ projectId: 'p1', limit: 10 })
  })

  it('asks for every conversation when the caller named no filter', async () => {
    await expect(adapter().conversations?.list()).resolves.toEqual([])
    expect(bridge.edgeAiListConversations).toHaveBeenCalledWith({})
  })

  it('keeps the transcript, its timestamps and the ratings the user left', async () => {
    bridge.edgeAiGetConversation.mockResolvedValueOnce({
      ok: true,
      data: {
        conversation: {
          id: 'c1',
          title: 'Ladder help',
          projectId: 'p1',
          updatedAt: '2026-01-02T03:04:05Z',
          messages: [
            {
              id: 'm1',
              role: 'assistant',
              content: [{ type: 'text', text: 'Hi' }],
              createdAt: '2026-01-01T00:00:00Z',
              rating: 'up',
            },
          ],
        },
      },
    })

    await expect(adapter().conversations?.get('c1')).resolves.toEqual({
      id: 'c1',
      title: 'Ladder help',
      projectId: 'p1',
      updatedAt: '2026-01-02T03:04:05Z',
      messages: [
        {
          id: 'm1',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          createdAt: '2026-01-01T00:00:00Z',
          rating: 'up',
        },
      ],
    })
  })

  it('reads a conversation with no transcript yet as an empty one', async () => {
    bridge.edgeAiCreateConversation.mockResolvedValueOnce({
      ok: true,
      data: { conversation: { id: 'c2', title: 'New chat', projectId: 'p1', updatedAt: '2026-01-02T03:04:05Z' } },
    })

    await expect(adapter().conversations?.create({ projectId: 'p1' })).resolves.toEqual({
      id: 'c2',
      title: 'New chat',
      projectId: 'p1',
      updatedAt: '2026-01-02T03:04:05Z',
      messages: [],
    })
    expect(bridge.edgeAiCreateConversation).toHaveBeenCalledWith({ projectId: 'p1' })
  })

  it('renames one, sending the title as the body the channel expects', async () => {
    bridge.edgeAiRenameConversation.mockResolvedValueOnce({
      ok: true,
      data: { conversation: { id: 'c1', title: 'Renamed' } },
    })

    await expect(adapter().conversations?.rename('c1', 'Renamed')).resolves.toEqual({ id: 'c1', title: 'Renamed' })
    expect(bridge.edgeAiRenameConversation).toHaveBeenCalledWith('c1', { title: 'Renamed' })
  })

  it('deletes one and answers nothing at all', async () => {
    await expect(adapter().conversations?.remove('c1')).resolves.toBeUndefined()
    expect(bridge.edgeAiDeleteConversation).toHaveBeenCalledWith('c1')
  })
})

describe('a buffered read under an abort signal', () => {
  it('is never made once the signal has already fired', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(adapter().fetchUsage(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(bridge.edgeAiFetchUsage).not.toHaveBeenCalled()
  })

  it('stops being waited on when the signal fires, and drops what arrives afterwards', async () => {
    let answer: (value: unknown) => void = () => undefined
    bridge.edgeAiFetchEntitlements.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve
      }),
    )
    const controller = new AbortController()

    const pending = adapter().fetchEntitlements(controller.signal)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })

    // The late answer has nowhere to go and must not throw.
    answer({ ok: true, data: { acu: { monthlyAcu: 100 } } })
    await settle()
  })

  it('answers normally when the signal never fires', async () => {
    const controller = new AbortController()

    await expect(adapter().fetchCredits(controller.signal)).resolves.toEqual({ credits_used: 1, credits_total: 500 })
  })
})

describe('the buffered read routes', () => {
  it('hand back the payload the main process already validated', async () => {
    const ai = adapter()

    await expect(ai.fetchEntitlements()).resolves.toEqual({ acu: { monthlyAcu: 100 } })
    await expect(ai.fetchUsage()).resolves.toEqual({ acu: { used: 4 } })
    await expect(ai.fetchCredits()).resolves.toEqual({ credits_used: 1, credits_total: 500 })
  })
})
