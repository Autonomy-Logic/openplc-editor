/**
 * Editor `AIPort` adapter — Autonomy Edge's AI routes, over IPC. Transport only: the prompt,
 * model, credits and conversation store all live on Edge. IPC structure-clones failures, so
 * `errorFromFailure` rebuilds `AIRequestError` (with `billing` intact) from the plain data.
 *
 * `registerInlineCompletions` is not on this port: Monaco calls `registerAIInlineCompletions`
 * from `frontend/services/ai` directly.
 */

import { z } from 'zod'

import type {
  AIChatParams,
  AICompleteParams,
  AIConversationDetail,
  AIConversationSummary,
  AIPort,
  AISSEEvent,
  AITelemetryEventName,
} from '../../shared/ports/ai-port'
import { AIRequestError } from '../../shared/ports/ai-port'

// ---------------------------------------------------------------------------
// Envelope validation
// ---------------------------------------------------------------------------

// Strict about `code`/`message` (the modal's copy depends on them); forgiving about the rest, so
// an unexpected shape costs one number rather than the whole refusal explanation.
const BillingErrorPayloadSchema = z.object({
  code: z.enum(['insufficient_acu', 'subscription_inactive', 'rate_limit_exceeded', 'subscription_past_due']),
  message: z.string(),
  remaining: z.number().optional().catch(undefined),
  required: z.number().optional().catch(undefined),
  monthlyLimit: z.number().optional().catch(undefined),
  subscriptionStatus: z
    .enum(['trialing', 'active', 'past_due', 'paused', 'canceled', 'expired'])
    .optional()
    .catch(undefined),
  reactivateUrl: z.string().url().optional().catch(undefined),
  resetsAt: z.string().nullable().optional().catch(undefined),
})

// Restated rather than imported: `backend/editor` is the main process's own layer and an
// adapter may not depend on it (`npm run validate:arch`).
const AiFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signed-out'), message: z.string() }),
  z.object({ kind: z.literal('unreachable'), message: z.string() }),
  z.object({ kind: z.literal('billing'), status: z.number(), message: z.string(), billing: BillingErrorPayloadSchema }),
  z.object({ kind: z.literal('http'), status: z.number(), message: z.string() }),
])

type AiFailure = z.infer<typeof AiFailureSchema>

// Only the discriminant is checked; the main process already validated the payload against the
// route's own schema, and an unchecked `result.ok` on a `null` answer would throw from inside the adapter.
const AiEnvelopeSchema = z.object({ ok: z.boolean() })

// One frame of a streamed answer. A frame that fails here means the two bundles disagree about
// the wire; it is dropped rather than thrown, so one missing frame doesn't cost the whole answer.
const AiSseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content_block_delta'), delta: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('message_stop'), stopReason: z.string().optional() }),
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('conversation_started'), conversationId: z.string(), conversationTitle: z.string() }),
])

type ParsedSseEvent = z.infer<typeof AiSseEventSchema>

// Rebuilt field by field, not passed through: zod infers `input: z.unknown()` as optional, while
// the contract says the key is always present. The exhaustive switch also catches an unmapped frame at compile time.
function toWireEvent(event: ParsedSseEvent): AISSEEvent {
  switch (event.type) {
    case 'content_block_delta':
      return { type: 'content_block_delta', delta: event.delta }
    case 'tool_use':
      return { type: 'tool_use', id: event.id, name: event.name, input: event.input }
    case 'message_stop':
      return { type: 'message_stop', stopReason: event.stopReason }
    case 'error':
      return { type: 'error', error: event.error }
    case 'conversation_started':
      return {
        type: 'conversation_started',
        conversationId: event.conversationId,
        conversationTitle: event.conversationTitle,
      }
  }
}

/** The answer this build cannot read at all — neither a success nor a failure it knows. */
function unreadableAnswer(): AIRequestError {
  return new AIRequestError('Autonomy Edge returned an answer this build of the editor cannot read.', 0)
}

// Rebuilds the port's error class from a reported failure (see file header). `status` and
// `billing` cross un-flattened — `billing` from the validated copy, so a field the schema
// couldn't parse reaches the modal as absent rather than garbage. `retryAfter` stays undefined:
// a 429's reset time lives in `billing.resetsAt` instead.
function errorFromFailure(reported: unknown): AIRequestError {
  const parsed = AiFailureSchema.safeParse(reported)

  if (!parsed.success) {
    return unreadableAnswer()
  }

  const failure: AiFailure = parsed.data

  switch (failure.kind) {
    case 'signed-out':
      // 401, so a caller that branches on status reads it as an authentication problem
      // rather than as a refusal on cost.
      return new AIRequestError(failure.message, 401)
    case 'unreachable':
      // Status 0: the server never answered, so NOTHING was learned. Reporting this as
      // a denial would tell someone their credits ran out when their wifi dropped.
      return new AIRequestError(failure.message, 0)
    case 'billing':
      return new AIRequestError(failure.message, failure.status, undefined, failure.billing)
    case 'http':
      return new AIRequestError(failure.message, failure.status)
  }
}

// Validates an answer and hands back its payload, or throws the error the UI branches on. The
// bridge's declared type checks nothing at runtime, so the envelope is parsed before `result.ok` is read.
function unwrap<T>(result: { ok: true; data: T } | { ok: false; failure: unknown }): T {
  if (!AiEnvelopeSchema.safeParse(result).success) {
    throw unreadableAnswer()
  }

  if (result.ok) {
    return result.data
  }

  throw errorFromFailure(result.failure)
}

// Binds one IPC channel, guarding against a main process that predates it — same guard and
// reason as the version-control adapter's `channel`.
function channel<A extends unknown[], T>(
  fn: ((...args: A) => Promise<{ ok: true; data: T } | { ok: false; failure: unknown }>) | undefined,
  name: string,
): (...args: A) => Promise<T> {
  return async (...args: A) => {
    if (typeof fn !== 'function') {
      throw new AIRequestError(`The assistant is unavailable in this build of the editor (${name} is missing).`, 0)
    }

    return unwrap(await fn(...args))
  }
}

/** What an aborted read rejects with — the same name the fetch-based web transport uses. */
function abortError(): Error {
  return new DOMException('The request was aborted.', 'AbortError')
}

// An IPC result cannot be cancelled, only stopped being waited on: a fired signal rejects the
// caller now and drops whatever the main process later answers.
function abortable<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return read()
  }

  if (signal.aborted) {
    return Promise.reject(abortError())
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())

    signal.addEventListener('abort', onAbort, { once: true })

    read()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

// One queue, not three: order between event/end/failure is the contract — an `end` that overtook
// a `tool_use` would stop the agentic loop before it learned it had work to do.
type StreamFrame =
  | { streamId: string; kind: 'event'; event: AISSEEvent }
  | { streamId: string; kind: 'end' }
  | { streamId: string; kind: 'failure'; failure: unknown }

/** Conversation and completion requests both cross as a plain object body. */
type StreamBody = Record<string, unknown>

const STREAM_CHANNELS_MISSING =
  'The assistant is unavailable in this build of the editor (the edge-ai stream channels are missing).'

/** The id the pushed frames are tagged with, or the error explaining why there is none. */
const StreamStartSchema = z.object({ streamId: z.string().min(1) })

/**
 * Turns the pushed `edge-ai:*` channels into an async iterator. Listeners attach before the
 * request opens (a fast stream can put frames on the wire before the id returns); frames that
 * land while the consumer is busy are queued, not dropped; every exit path — return, throw, or an
 * abandoned `for await` — unsubscribes and aborts upstream so the server stops billing unread tokens.
 */
async function* streamFrames(
  kind: 'chat' | 'completion',
  body: StreamBody,
  signal?: AbortSignal,
): AsyncGenerator<AISSEEvent, void, unknown> {
  const { bridge } = window

  // All four are checked together, before anything is subscribed. Checking them one at a
  // time would leave a listener attached when the second one turned out to be missing,
  // and a listener nothing can ever remove outlives every stream that follows.
  if (
    typeof bridge.edgeAiStreamStart !== 'function' ||
    typeof bridge.onEdgeAiStreamEvent !== 'function' ||
    typeof bridge.onEdgeAiStreamEnd !== 'function' ||
    typeof bridge.onEdgeAiStreamError !== 'function'
  ) {
    throw new AIRequestError(STREAM_CHANNELS_MISSING, 0)
  }

  const queue: StreamFrame[] = []
  let wake: (() => void) | null = null

  // Hands the waiting consumer whatever just landed; a busy consumer finds it in the queue.
  const push = (frame: StreamFrame): void => {
    queue.push(frame)

    const resume = wake

    wake = null
    resume?.()
  }

  const unsubscribe = [
    bridge.onEdgeAiStreamEvent(({ streamId, event }) => push({ streamId, kind: 'event', event })),
    bridge.onEdgeAiStreamEnd(({ streamId }) => push({ streamId, kind: 'end' })),
    bridge.onEdgeAiStreamError(({ streamId, failure }) => push({ streamId, kind: 'failure', failure })),
  ]

  let streamId: string | null = null
  let finished = false

  // Read through a call, not inline: `signal.aborted` flips while the generator is parked, and TS
  // would narrow an inline read before the loop and believe it can never be true again.
  const isAborted = (): boolean => signal?.aborted === true

  // Fire-and-forget: the caller already stopped listening, so a rejected abort has nowhere to be
  // reported. Safe on any exit path since aborting an already-ended stream is a no-op.
  const abortUpstream = (): void => {
    if (streamId === null || finished) {
      return
    }

    finished = true

    if (typeof bridge.edgeAiStreamAbort === 'function') {
      void bridge.edgeAiStreamAbort(streamId).catch(() => {
        // Nothing to do and nobody to tell: the reader is already gone.
      })
    }
  }

  // Wakes the parked consumer directly: a cancelled stream emits no further `onEnd`/`onFailure`,
  // so nothing else would ever wake it.
  const onAbort = (): void => {
    abortUpstream()

    const resume = wake

    wake = null
    resume?.()
  }

  signal?.addEventListener('abort', onAbort)

  try {
    if (isAborted()) {
      // Asked to stop before the request was made: the cheapest correct answer is not
      // to make it. Nothing has been opened, so there is nothing to abort.
      return
    }

    const started = unwrap(await bridge.edgeAiStreamStart({ kind, body }))
    const parsed = StreamStartSchema.safeParse(started)

    if (!parsed.success) {
      throw unreadableAnswer()
    }

    streamId = parsed.data.streamId

    if (isAborted()) {
      // The abort landed while the request was being opened, when there was no id to
      // cancel with. There is one now.
      abortUpstream()

      return
    }

    while (true) {
      // Checked before the queue rather than only when it empties: a caller that pressed
      // stop is not waiting to be handed the frames that were already in flight.
      if (isAborted()) {
        return
      }

      const frame = queue.shift()

      if (!frame) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })

        continue
      }

      // A frame from a stream this generator did not open: the panel and an inline completion can
      // be talking to the model at once, both listening on the same channels.
      if (frame.streamId !== streamId) {
        continue
      }

      if (frame.kind === 'end') {
        finished = true

        return
      }

      if (frame.kind === 'failure') {
        finished = true

        throw errorFromFailure(frame.failure)
      }

      const event = AiSseEventSchema.safeParse(frame.event)

      // A shape mismatch on a known type means the two bundles disagree about the wire; skipped
      // rather than thrown, so a stale renderer degrades to a shorter answer instead of a broken stream.
      if (!event.success) {
        continue
      }

      const wire = toWireEvent(event.data)

      if (wire.type === 'error') {
        // Thrown, not yielded, matching the web transport: the agentic loop has no branch for an
        // `error` event. Status 0 — the request succeeded, the model failed mid-generation.
        finished = true

        throw new AIRequestError(wire.error, 0)
      }

      yield wire

      if (wire.type === 'message_stop') {
        // The answer is complete. The main process has already cancelled the socket on
        // its side, so returning here is an ordinary end rather than an abort.
        finished = true

        return
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)

    for (const off of unsubscribe) {
      off()
    }

    // Reached on throw, on a clean return, and on the caller breaking its `for await`; only the
    // unfinished cases actually send anything, since the server keeps billing tokens until the socket goes.
    abortUpstream()
  }
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/** A stored conversation as the backend returns it, narrowed to what the port promises. */
const StoredConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullish(),
  updatedAt: z.string(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(['user', 'assistant']),
        // Opaque on the way through, as the port declares it: content shape is the wire's business.
        content: z.unknown(),
        createdAt: z.string(),
        rating: z.enum(['up', 'down']).nullish(),
      }),
    )
    .optional(),
})

const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  projectId: z.string().nullish(),
  updatedAt: z.string(),
})

const ConversationListSchema = z.object({ conversations: z.array(ConversationSummarySchema) })
const ConversationOneSchema = z.object({ conversation: StoredConversationSchema })
const ConversationRenamedSchema = z.object({ conversation: z.object({ id: z.string(), title: z.string() }) })

/** Parse a payload the main process already answered `ok` for, or say it is unreadable. */
function readPayload<T>(schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)

  if (!parsed.success) {
    throw unreadableAnswer()
  }

  return parsed.data
}

function toSummary(conversation: z.infer<typeof ConversationSummarySchema>): AIConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    projectId: conversation.projectId,
  }
}

function toDetail(conversation: z.infer<typeof StoredConversationSchema>): AIConversationDetail {
  return {
    ...toSummary(conversation),
    // Absent transcript = empty one (`create` returns a conversation with nothing in it yet).
    // Each turn is rebuilt field by field for the same optional-key reason as `toWireEvent`.
    messages: (conversation.messages ?? []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      rating: message.rating,
    })),
  }
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface EditorAIAdapterConfig {
  isFeatureEnabled: boolean
  hasUserConsented: boolean
  inlineCompletionsEnabled: boolean
}

export function createEditorAIAdapter(config: EditorAIAdapterConfig): AIPort {
  const { bridge } = window

  const fetchEntitlements = channel(bridge.edgeAiFetchEntitlements, 'edge-ai:entitlements')
  const fetchUsage = channel(bridge.edgeAiFetchUsage, 'edge-ai:usage')
  const fetchCredits = channel(bridge.edgeAiFetchCredits, 'edge-ai:credits')
  const listConversations = channel(bridge.edgeAiListConversations, 'edge-ai:conversations-list')
  const getConversation = channel(bridge.edgeAiGetConversation, 'edge-ai:conversations-get')
  const createConversation = channel(bridge.edgeAiCreateConversation, 'edge-ai:conversations-create')
  const renameConversation = channel(bridge.edgeAiRenameConversation, 'edge-ai:conversations-rename')
  const deleteConversation = channel(bridge.edgeAiDeleteConversation, 'edge-ai:conversations-delete')

  // The one chat call; both prose methods below are derived from it so the flattened and
  // structured views can never disagree about what the model said.
  const chatEvents = (params: AIChatParams, signal?: AbortSignal): AsyncGenerator<AISSEEvent, void, unknown> =>
    streamFrames('chat', { ...params }, signal)

  return {
    isFeatureEnabled: config.isFeatureEnabled,
    hasUserConsented: config.hasUserConsented,
    inlineCompletionsEnabled: config.inlineCompletionsEnabled,

    async *streamCompletion(params: AICompleteParams, signal?: AbortSignal) {
      for await (const event of streamFrames('completion', { ...params }, signal)) {
        if (event.type === 'content_block_delta') {
          yield event.delta
        }
      }
    },

    async *streamChat(params: AIChatParams, signal?: AbortSignal) {
      for await (const event of chatEvents(params, signal)) {
        if (event.type === 'content_block_delta') {
          yield event.delta
        }
      }
    },

    streamChatEvents: chatEvents,

    // The three read routes hand back what the main process already validated against
    // the route's schema; `unwrap` has checked the envelope it came in.
    fetchEntitlements: (signal?: AbortSignal) => abortable(() => fetchEntitlements(), signal),

    fetchUsage: (signal?: AbortSignal) => abortable(() => fetchUsage(), signal),

    fetchCredits: (signal?: AbortSignal) => abortable(() => fetchCredits(), signal),

    // Fire-and-forget, deliberately silent: a metrics outage must not toast on top of the user's work.
    sendTelemetry(event: AITelemetryEventName, data: Record<string, unknown>): void {
      if (typeof bridge.edgeAiSendTelemetry !== 'function') {
        return
      }

      void bridge.edgeAiSendTelemetry(event, { ...data, timestamp: Date.now() }).catch(() => {
        // Nothing the user can act on.
      })
    },

    // Never throws and is never awaited, as the port requires: a cold cache just costs a slower first completion.
    warmCache(): void {
      if (typeof bridge.edgeAiWarm !== 'function') {
        return
      }

      void bridge.edgeAiWarm().catch(() => {
        // A cold cache is the whole cost of this failing.
      })
    },

    conversations: {
      async list(options?: { projectId?: string; limit?: number; offset?: number }): Promise<AIConversationSummary[]> {
        const payload = await listConversations(options ?? {})

        return readPayload(ConversationListSchema, payload).conversations.map(toSummary)
      },

      async get(id: string): Promise<AIConversationDetail> {
        return toDetail(readPayload(ConversationOneSchema, await getConversation(id)).conversation)
      },

      async create(input: { projectId?: string; title?: string }): Promise<AIConversationDetail> {
        return toDetail(readPayload(ConversationOneSchema, await createConversation({ ...input })).conversation)
      },

      async rename(id: string, title: string): Promise<{ id: string; title: string }> {
        return readPayload(ConversationRenamedSchema, await renameConversation(id, { title })).conversation
      },

      async remove(id: string): Promise<void> {
        await deleteConversation(id)
      },
    },
  }
}
