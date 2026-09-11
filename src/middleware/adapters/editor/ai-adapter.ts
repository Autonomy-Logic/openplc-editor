/**
 * Editor `AIPort` adapter — Autonomy Edge's AI routes, over IPC.
 *
 * Nothing about the assistant runs in the renderer. The prompt, the model, the credit
 * accounting and the conversation store all live on Edge, and the desktop reaches them
 * through the main process because the access token is deliberately never handed to the
 * renderer — the same arrangement the account and version-control adapters use. What is
 * left here is transport: turn a pushed IPC stream back into an `AsyncGenerator`, and
 * turn reported failures back into the error class the shared UI branches on.
 *
 * REBUILDING `AIRequestError` IS THE POINT OF THIS FILE, exactly as rebuilding the
 * conflict errors is the point of `version-control-adapter.ts`. IPC structure-clones its
 * payloads and the prototype does not survive, so an error raised in the main process
 * arrives here as a plain object and every `instanceof AIRequestError` in the shared chat
 * panel and the shared agentic loop quietly answers false. The main process therefore
 * reports failures as plain data with a `kind`, and `errorFromFailure` below turns them
 * back into the class — carrying `billing` WHOLE rather than flattened to a sentence,
 * because the ACU exhaustion modal is built out of that payload and nothing else. Get it
 * wrong and someone who has run out of credits sees a generic red toast.
 *
 * `registerInlineCompletions` is not implemented and is no longer on the port: the shared
 * Monaco editor calls `registerAIInlineCompletions` from `frontend/services/ai` directly.
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

/**
 * The billing refusal, validated field by field.
 *
 * Strict about `code` and `message` and forgiving about the rest, because the modal
 * chooses its copy from `code` and would have nothing to say without it, while a
 * `remaining` that arrives in an unexpected shape costs the user one number rather than
 * the whole explanation of why their request was refused.
 */
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

/**
 * The failure taxonomy the main process reports, restated as a schema.
 *
 * Restated rather than imported: `backend/editor` is the main process's own layer and an
 * adapter may not depend on it (`npm run validate:arch`). The union is small and the
 * `kind` values are the contract, so the cost of the second copy is bounded — and this
 * one earns its keep by actually checking, which the declared type on the bridge does
 * not do once a value has crossed IPC.
 */
const AiFailureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('signed-out'), message: z.string() }),
  z.object({ kind: z.literal('unreachable'), message: z.string() }),
  z.object({ kind: z.literal('billing'), status: z.number(), message: z.string(), billing: BillingErrorPayloadSchema }),
  z.object({ kind: z.literal('http'), status: z.number(), message: z.string() }),
])

type AiFailure = z.infer<typeof AiFailureSchema>

/**
 * Only the discriminant is checked here, and the payload is left alone on purpose — the
 * same split `VersionControlResultSchema` makes. The main process already validated
 * every payload against the route's own schema before answering, so re-deriving those
 * shapes on this side would be a second copy of the wire contract to keep in step for no
 * decision made here. What must be checked is the part this file reads: a main process
 * that answered `null` would make `result.ok` raise a `TypeError` from inside the
 * adapter, which reaches the user as a toast with no message on it.
 */
const AiEnvelopeSchema = z.object({ ok: z.boolean() })

/**
 * One frame of a streamed answer, checked before it is handed to the agentic loop.
 *
 * The main process validates frames as they come off the socket, so a frame that fails
 * here means the two bundles disagree about the wire — a partial rebuild, or an app that
 * updated one side. Such a frame is DROPPED rather than treated as an error: losing one
 * frame of an answer is bad, and losing the whole answer over a frame nobody needed
 * (a shape added upstream that this build has no branch for) is worse.
 */
const AiSseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content_block_delta'), delta: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('message_stop'), stopReason: z.string().optional() }),
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('conversation_started'), conversationId: z.string(), conversationTitle: z.string() }),
])

type ParsedSseEvent = z.infer<typeof AiSseEventSchema>

/**
 * The parsed frame as the port declares it.
 *
 * Rebuilt field by field rather than passed straight through, for a narrow reason: zod
 * infers any key whose type admits `undefined` as OPTIONAL, so `input: z.unknown()`
 * produces `input?: unknown` while the contract says the key is always there. Naming each
 * field closes that gap without an assertion, and the `switch` is exhaustive — a frame
 * added to the schema and not to the contract is a compile error here rather than a frame
 * that silently never arrives. The main process rebuilds the same shape for the same
 * reason, on its own side of the boundary.
 */
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

/**
 * Rebuild the port's error class from a reported failure.
 *
 * This is the whole reason the file exists. The failure arrives as plain data because a
 * class does not survive the structured clone, and the shared UI decides what to show
 * with `instanceof AIRequestError` — so it has to become one again here.
 *
 * `status` separates a 402 from a 500 and `billing` is what opens the exhaustion modal,
 * so both cross un-flattened, and `billing` is taken from the VALIDATED copy: a field the
 * schema had to fall back on reaches the modal as absent rather than as whatever
 * unreadable value it arrived as.
 *
 * `retryAfter` stays undefined: the failure union carries no `Retry-After` (a 429 says when in `billing.resetsAt`).
 */
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

/**
 * Validate an answer and hand back its payload, or throw the error the UI branches on.
 *
 * `result` is typed by the bridge, but that type checked nothing on the way across, so
 * the envelope is parsed before `result.ok` is read.
 */
function unwrap<T>(result: { ok: true; data: T } | { ok: false; failure: unknown }): T {
  if (!AiEnvelopeSchema.safeParse(result).success) {
    throw unreadableAnswer()
  }

  if (result.ok) {
    return result.data
  }

  throw errorFromFailure(result.failure)
}

/**
 * Bind one IPC channel, guarding against a main process that predates it.
 *
 * A renderer bundle is not always paired with the main bundle it was built beside — a
 * partial rebuild during development, or an app that updated one side, leaves the
 * channel missing. Reading straight through would raise `... is not a function` from
 * inside a render effect and take the workspace down rather than the panel that asked.
 * Same guard, and the same reason, as the version-control adapter's.
 */
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

/**
 * Run a buffered read under a signal. An IPC result cannot be cancelled, only stopped
 * being waited on: a signal that fires rejects the caller now, and whatever the main
 * process later answers is dropped. Already aborted, the request is not even made.
 */
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

/**
 * What arrives on the pushed channels, in the order it arrived.
 *
 * Kept as one queue rather than three, because order between them is the contract: an
 * `error` failure that overtook the last delta would truncate the answer, and an `end`
 * that overtook a `tool_use` would stop the agentic loop one frame before it learned it
 * had work to do.
 */
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
 * Turn the pushed `edge-ai:*` channels back into an async iterator.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 *  - The listeners are attached BEFORE the request is opened. `invoke` and the pushed
 *    channels are separate IPC messages, so a stream that starts producing on the same
 *    tick can put frames on the wire before the id has come back — subscribing after
 *    would drop the first words of the answer.
 *  - Frames that arrive before the consumer pulls are QUEUED, not dropped. A generator
 *    only runs between `next()` calls, and the model does not wait: everything that
 *    lands while the caller is busy rendering the last delta has to still be there when
 *    it comes back.
 *  - Every exit path unsubscribes — return, `throw`, and the caller breaking out of its
 *    `for await` early. The last is the one that leaks: an abandoned generator's
 *    `finally` is the only place left to both detach the listeners and tell the server
 *    to stop generating tokens nobody will read.
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

  /** Hand the waiting consumer whatever just landed; a consumer that is busy finds it in the queue. */
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

  /**
   * Read the signal through a call rather than inline.
   *
   * `signal.aborted` flips underneath us while the generator is parked, and an inline
   * read gets narrowed by the check before the loop — the compiler then believes it can
   * never be true again, which is exactly the bug that would leave a stopped stream
   * running.
   */
  const isAborted = (): boolean => signal?.aborted === true

  /**
   * Tell the main process to drop the request.
   *
   * Fire-and-forget by design: the caller has already stopped listening, and a rejected
   * abort has nowhere to be reported. Aborting a stream that already ended is a no-op
   * on the far side, so this is safe to call on any exit path.
   */
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

  // Wired to the same queue as the pushed channels so an abort that arrives while the
  // consumer is parked wakes it. Cancelling emits no further event from the main
  // process — the module calls neither `onEnd` nor `onFailure` for a cancelled stream —
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

      // Frames of a stream this generator did not open — the panel and an inline
      // completion can be talking to the model at once, and both listen on the same
      // channels.
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

      // The main process already dropped unknown frame types; this rejects a frame
      // whose SHAPE is wrong for a type we do know, which can only mean the two
      // bundles disagree about the wire format. Skipped rather than thrown, so a
      // stale renderer degrades to a shorter answer instead of a broken stream.
      if (!event.success) {
        continue
      }

      const wire = toWireEvent(event.data)

      if (wire.type === 'error') {
        // Thrown rather than yielded, which is what the web transport does with the
        // same frame: the agentic loop has no branch for an `error` event and decides
        // what to show from the thrown `AIRequestError`. Status 0 because the request
        // itself succeeded and the model failed partway through generating — there is
        // no HTTP status to blame.
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

    // Reached on a `throw` and on the caller breaking out of its `for await` as well as
    // on a clean return. Only the unfinished cases actually send anything — the server
    // keeps generating until the socket goes, and every token it produces after the
    // reader left is billed to someone who will never see it.
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
        // Opaque on the way through, exactly as the port declares it: what a turn holds
        // is the wire's business, and restating it here would be a second copy of a
        // shape the server owns.
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
    // An absent transcript is an empty one, not a missing conversation: `create`
    // answers with a conversation that has nothing in it yet. Each turn is rebuilt
    // rather than spread for the same reason `toWireEvent` rebuilds a frame: zod reports
    // `content: z.unknown()` as an optional key, and the port says the key is always
    // there.
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

  /**
   * The one chat call. Both prose methods below are fed from it, so the flattened view
   * and the structured view can never disagree about what the model said — the port
   * says an adapter implements this one and derives the others, never the reverse.
   */
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

    /**
     * Fire-and-forget, and deliberately silent. Telemetry that surfaced its own failures
     * would turn a metrics outage into a wall of toasts on top of whatever the user was
     * actually doing.
     */
    sendTelemetry(event: AITelemetryEventName, data: Record<string, unknown>): void {
      if (typeof bridge.edgeAiSendTelemetry !== 'function') {
        return
      }

      void bridge.edgeAiSendTelemetry(event, { ...data, timestamp: Date.now() }).catch(() => {
        // Nothing the user can act on.
      })
    },

    /**
     * Never throws and is never awaited, as the port requires: a cold prompt cache costs
     * a slower first completion, which is not worth delaying the editor for.
     */
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
