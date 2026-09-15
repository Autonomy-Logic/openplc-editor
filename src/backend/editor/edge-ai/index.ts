// Proxy onto Autonomy Edge's AI routes from the main process: the renderer never holds the access token.
// Failures are plain `{ kind }` data — a thrown class instance loses its prototype crossing IPC.

import { z } from 'zod'

import type { AICreditStatus, AISSEEvent, AITelemetryEventName } from '../../../middleware/shared/ports/ai-port'
import type { AIEntitlements, AIUsage, BillingErrorPayload } from '../../../middleware/shared/ports/types'
import { edgeAccessToken, edgeAuthedRequest } from '../edge-account/edge-account-service'
import type { EdgeStreamHandle } from '../edge-account/edge-http'
import { EdgeStreamHttpError, edgeStreamRequest, parseJsonBody, parseJsonBodyAs } from '../edge-account/edge-http'

/** Serialisable failure. `unreachable` means no answer at all and must never be shown as a denial. */
export type EdgeAiFailure =
  | { kind: 'signed-out'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'billing'; status: number; message: string; billing: BillingErrorPayload }
  | { kind: 'http'; status: number; message: string }

/** No session, phrased once so every route says the same thing. */
const SIGNED_OUT: EdgeAiFailure = { kind: 'signed-out', message: 'Sign in to Autonomy Edge to use the assistant.' }

export type EdgeAiResult<T> = { ok: true; data: T } | { ok: false; failure: EdgeAiFailure }

/** Nest wraps every answer as `{ statusCode, data }`. */
const edgeEnvelopeOf = <Schema extends z.ZodTypeAny>(data: Schema) =>
  z.object({ statusCode: z.number().optional(), data: data.optional() })

/** A `message` field as Nest's exception filter writes it. */
const FailureBodySchema = z.object({ message: z.union([z.string(), z.array(z.string())]).nullish() })

const SubscriptionStatusSchema = z.enum(['trialing', 'active', 'past_due', 'paused', 'canceled', 'expired'])

// `.catch(false)` per flag: one unreadable flag must not take the whole entitlements read down.
const PlanFeaturesSchema = z.record(z.boolean().catch(false))

const EntitlementSourceSchema = z.object({
  subscriptionId: z.string(),
  subscriptionStatus: SubscriptionStatusSchema,
  planSlug: z.string(),
  planDisplayName: z.string(),
  planLevelSlug: z.enum(['standard', 'plus', 'premium']),
  tier: z.number(),
})

const AiEntitlementsSchema = z.object({
  source: EntitlementSourceSchema,
  limits: z.object({
    maxOrchestrators: z.number().nullable(),
    maxDevices: z.number().nullable(),
    maxPrivateProjects: z.number().nullable(),
    maxPublicProjects: z.number().nullable(),
    maxOrgMembers: z.number().nullable(),
    maxTeamWorkspaces: z.number().nullable(),
  }),
  acu: z.object({
    monthlyAcu: z.number(),
    rateLimitWindowHours: z.number(),
    rateLimitWindowPercent: z.number(),
    marginPercent: z.number().nullable(),
  }),
  features: PlanFeaturesSchema,
})
// No `satisfies z.ZodType<AIEntitlements>`: `PlanFeatures`' `boolean | undefined` index signature cannot round-trip.

const UsageCounterSchema = z.object({
  used: z.number(),
  limit: z.number().nullable(),
  remaining: z.number().nullable(),
})

const AiUsageSchema = z.object({
  source: EntitlementSourceSchema,
  orchestrators: UsageCounterSchema,
  devices: UsageCounterSchema,
  privateProjects: UsageCounterSchema,
  publicProjects: UsageCounterSchema,
  organizations: z.object({ used: z.number(), allowed: z.boolean() }),
  acu: z.object({
    used: z.number(),
    monthlyLimit: z.number(),
    remaining: z.number(),
    rateLimitWindowHours: z.number(),
    rateLimitWindowPercent: z.number(),
  }),
}) satisfies z.ZodType<AIUsage>

const AiCreditStatusSchema = z.object({
  credits_used: z.number(),
  credits_total: z.number(),
  tier: z.enum(['free', 'pro']),
  current_period_end: z.string().nullable(),
}) satisfies z.ZodType<AICreditStatus>

const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  lastModel: z.enum(['haiku', 'sonnet']).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** `content` stays opaque: its block shapes belong to the chat UI. */
const ConversationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.array(z.unknown()),
  rating: z.enum(['up', 'down']).nullable(),
  turnIndex: z.number(),
  createdAt: z.string(),
})

const ConversationDetailSchema = z.object({
  id: z.string(),
  userId: z.string(),
  projectId: z.string(),
  title: z.string(),
  lastModel: z.enum(['haiku', 'sonnet']).nullable(),
  messages: z.array(ConversationMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>

/** Readable reason from a failure body; Edge's exception filter nests the Nest body under `error`. */
function messageFromBody(body: string, status: number): string {
  const root = parseJsonBody(body)
  const wrapped = WrappedFailureSchema.safeParse(root)
  const parsed = FailureBodySchema.safeParse(wrapped.success ? wrapped.data.error : root)
  const raw = parsed.success ? parsed.data.message : undefined

  if (Array.isArray(raw) && raw.length > 0) {
    return raw.join('; ')
  }

  if (typeof raw === 'string' && raw.length > 0) {
    return raw
  }

  return `Autonomy Edge answered ${status}.`
}

/** The CreditGuard refusal. Per-field `.catch`: failing the whole parse would cost the user the modal. */
const BillingPayloadSchema = z.object({
  // Only the codes CreditGuard throws count as billing; a proxy's own 402 stays an ordinary failure.
  error: z.enum(['insufficient_acu', 'subscription_inactive', 'rate_limit_exceeded', 'subscription_past_due']),
  message: z.string().catch('Credit limit reached.'),
  remaining: z.number().optional().catch(undefined),
  required: z.number().optional().catch(undefined),
  monthlyLimit: z.number().optional().catch(undefined),
  subscriptionStatus: SubscriptionStatusSchema.optional().catch(undefined),
  reactivateUrl: z.string().url().optional().catch(undefined),
  resetsAt: z.string().nullable().optional().catch(undefined),
})

/** Edge's `GlobalExceptionFilter` nests the thrown body under `error`; the bare shape is what tests send. */
const WrappedFailureSchema = z.object({ error: z.record(z.unknown()) })

function parseBillingPayload(body: string): BillingErrorPayload | null {
  const root = parseJsonBody(body)
  const wrapped = WrappedFailureSchema.safeParse(root)
  const parsed = BillingPayloadSchema.safeParse(wrapped.success ? wrapped.data.error : root)

  if (!parsed.success) {
    return null
  }

  const { error, ...rest } = parsed.data

  return { code: error, ...rest }
}

/** 429 with a billing payload is `billing` too: its `resetsAt` drives the same modal. */
function failureFromStatus(status: number, body: string): EdgeAiFailure {
  if (status === 402 || status === 429) {
    const billing = parseBillingPayload(body)

    if (billing) {
      return { kind: 'billing', status, message: billing.message, billing }
    }
  }

  // A 401 that reaches here already survived a renewal, so it is a real one.
  if (status === 401) {
    return SIGNED_OUT
  }

  return { kind: 'http', status, message: messageFromBody(body, status) }
}

/** One authenticated call, with the failure taxonomy applied. */
async function call<Schema extends z.ZodTypeAny>(
  path: string,
  schema: Schema,
  init: { method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'; json?: unknown } = {},
): Promise<EdgeAiResult<z.infer<Schema>>> {
  let response: { status: number; body: string } | null

  try {
    response = await edgeAuthedRequest(path, init)
  } catch (error) {
    // A rejection means no answer at all; it must not be reported as a denial.
    return {
      ok: false,
      failure: { kind: 'unreachable', message: error instanceof Error ? error.message : 'No answer' },
    }
  }

  if (!response) {
    return { ok: false, failure: SIGNED_OUT }
  }

  const { status, body } = response

  if (status >= 400) {
    return { ok: false, failure: failureFromStatus(status, body) }
  }

  const envelope = parseJsonBodyAs(body, edgeEnvelopeOf(schema))

  if (!envelope || envelope.data === undefined) {
    // A 2xx whose body we cannot read is not a success we can hand to the UI.
    return {
      ok: false,
      failure: { kind: 'http', status, message: 'Autonomy Edge returned an unreadable response.' },
    }
  }

  return { ok: true, data: envelope.data }
}

/** For the routes whose answer the caller ignores. */
async function callVoid(
  path: string,
  init: { method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'; json?: unknown } = {},
): Promise<EdgeAiResult<null>> {
  const result = await call(path, z.unknown(), init)

  // DELETE answers 204 with no body; that is a success, not an unreadable body.
  if (!result.ok && result.failure.kind === 'http' && result.failure.status < 400) {
    return { ok: true, data: null }
  }

  return result.ok ? { ok: true, data: null } : result
}

/** Fire-and-forget; never rejects. Returned so a test can await it. */
async function beacon(path: string, json?: unknown): Promise<void> {
  try {
    await edgeAuthedRequest(path, { method: 'POST', json })
  } catch {
    // Best effort by definition.
  }
}

/** Every `/ai/chat` and `/ai/complete` frame. Validated: an object `delta` would render as `[object Object]`. */
const SseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content_block_delta'), delta: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('message_stop'), stopReason: z.string().optional() }),
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('conversation_started'), conversationId: z.string(), conversationTitle: z.string() }),
])

type AiSseEvent = z.infer<typeof SseEventSchema>

// Field by field: zod infers `input: z.unknown()` as optional, and the exhaustive switch catches new frames.
function toWireEvent(event: AiSseEvent): AISSEEvent {
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

/** Exactly one of `onEnd` / `onFailure` is called, once; cancelling calls neither. */
export interface AiStreamSink {
  /** One structured frame, in order. `tool_use` must survive: flattening to text is the adapter's job. */
  onEvent(event: AISSEEvent): void
  /** Upstream HTTP status, once, before any delta. Diagnostic only. */
  onStatus?(status: number): void
  onEnd(): void
  onFailure(failure: EdgeAiFailure): void
}

export interface AiStreamHandle {
  /** Abandon the answer. See {@link EdgeStreamHandle.cancel} for why the socket goes. */
  cancel(): void
}

/** What one attempt at a stream ended up being. */
type StreamOutcome = { kind: 'done' } | { kind: 'failed'; failure: EdgeAiFailure } | { kind: 'unauthorized' }

/** `[DONE]` is Edge's sentinel and not JSON, so it is matched before parsing. */
function parseSseLine(line: string): AiSseEvent | null {
  if (!line.startsWith('data: ')) {
    return null
  }

  const data = line.slice('data: '.length)

  if (data === '[DONE]') {
    return { type: 'message_stop' }
  }

  const parsed = SseEventSchema.safeParse(parseJsonBody(data))

  // Unknown frame types are dropped: there is no `AISSEEvent` member for them to cross IPC as.
  return parsed.success ? parsed.data : null
}

/** Re-assemble SSE lines across chunk boundaries; a `data:` frame routinely arrives split. */
function createSseReader(): { push(text: string): AiSseEvent[]; flush(): AiSseEvent[] } {
  let buffer = ''

  const harvest = (lines: string[]): AiSseEvent[] => {
    const events: AiSseEvent[] = []

    for (const line of lines) {
      const event = parseSseLine(line.trim())

      if (event) {
        events.push(event)
      }
    }

    return events
  }

  return {
    push(text: string) {
      buffer += text

      const lines = buffer.split('\n')

      // The tail is a whole line only if the chunk ended on a newline (then it is '').
      buffer = lines.pop() ?? ''

      return harvest(lines)
    },
    flush() {
      const rest = buffer

      buffer = ''

      return harvest([rest])
    },
  }
}

/** Returns the outcome that ends the stream, or null to keep reading. */
function applyEvent(event: AiSseEvent, sink: AiStreamSink): StreamOutcome | null {
  // Forwarded first so the consumer also sees the frame that ended the stream.
  sink.onEvent(toWireEvent(event))

  switch (event.type) {
    case 'content_block_delta':
      return null

    case 'error':
      // Status 0: the model failed mid-answer, there is no HTTP status to blame.
      return { kind: 'failed', failure: { kind: 'http', status: 0, message: event.error } }

    case 'message_stop':
      return { kind: 'done' }

    case 'tool_use':
    case 'conversation_started':
      return null
  }
}

/** Idle budget for an AI answer. Generous, because the model's pace is not a failure. */
const AI_STREAM_IDLE_TIMEOUT_MS = 120_000

/** One attempt on one token. Never rejects; `adopt` hands the transport out early so a cancel reaches the socket. */
function attemptStream(
  path: string,
  body: unknown,
  token: string,
  sink: AiStreamSink,
  adopt: (handle: EdgeStreamHandle) => void,
): Promise<StreamOutcome> {
  return new Promise((resolve) => {
    const reader = createSseReader()
    let handle: EdgeStreamHandle | null = null
    let stopped = false

    const settle = (outcome: StreamOutcome): void => {
      if (stopped) {
        return
      }

      stopped = true
      // The server keeps generating (and billing) until the socket goes.
      handle?.cancel()
      resolve(outcome)
    }

    const consume = (events: AiSseEvent[]): void => {
      for (const event of events) {
        if (stopped) {
          return
        }

        const outcome = applyEvent(event, sink)

        if (outcome) {
          settle(outcome)
        }
      }
    }

    handle = edgeStreamRequest(
      path,
      { method: 'POST', json: body, accessToken: token, timeoutMs: AI_STREAM_IDLE_TIMEOUT_MS },
      {
        onStatus: (status) => sink.onStatus?.(status),
        onChunk: (text) => consume(reader.push(text)),
        onEnd: () => {
          // A stream ending without `[DONE]` may still hold a frame in the buffer.
          consume(reader.flush())
          settle({ kind: 'done' })
        },
        onError: (error) => {
          if (!(error instanceof EdgeStreamHttpError)) {
            settle({ kind: 'failed', failure: { kind: 'unreachable', message: error.message } })

            return
          }

          // 401 kept apart so the caller can renew and retry; nothing has been emitted yet.
          settle(error.status === 401 ? { kind: 'unauthorized' } : failed(error))
        },
      },
    )

    if (stopped) {
      // The transport can refuse synchronously (cleartext base URL); the handle arrives already spent.
      handle.cancel()

      return
    }

    adopt(handle)
  })
}

function failed(error: EdgeStreamHttpError): StreamOutcome {
  return { kind: 'failed', failure: failureFromStatus(error.status, error.body) }
}

/** Drive a stream, renewing the token once on 401; safe because a 401 arrives before any text. */
async function driveStream(path: string, body: unknown, sink: AiStreamSink, state: StreamState): Promise<void> {
  const report = (outcome: StreamOutcome): void => {
    if (outcome.kind === 'done') {
      sink.onEnd()
    } else if (outcome.kind === 'failed') {
      sink.onFailure(outcome.failure)
    } else {
      // A 401 that survived a forced renewal is a session that is genuinely gone.
      sink.onFailure(SIGNED_OUT)
    }
  }

  try {
    for (const forceRenewal of [false, true]) {
      const token = await edgeAccessToken({ forceRenewal })

      if (state.cancelled) {
        return
      }

      if (!token) {
        sink.onFailure(SIGNED_OUT)

        return
      }

      const outcome = await attemptStream(path, body, token, sink, state.adopt)

      if (state.cancelled) {
        return
      }

      if (outcome.kind !== 'unauthorized' || forceRenewal) {
        report(outcome)

        return
      }
    }
  } catch (error) {
    // A renewal that never reached the server is offline, not signed out.
    sink.onFailure({ kind: 'unreachable', message: error instanceof Error ? error.message : 'No answer' })
  }
}

interface StreamState {
  cancelled: boolean
  adopt: (handle: EdgeStreamHandle) => void
}

/** Synchronous so the IPC layer can file the handle before a cancel can arrive; `cancelled` covers the gap. */
function startStream(path: string, body: unknown, sink: AiStreamSink): AiStreamHandle {
  let transport: EdgeStreamHandle | null = null

  const state: StreamState = {
    cancelled: false,
    adopt: (handle) => {
      transport = handle
    },
  }

  // Every callback is gated once here rather than at each call site.
  const guarded: AiStreamSink = {
    onEvent: (event) => {
      if (!state.cancelled) sink.onEvent(event)
    },
    onStatus: (status) => {
      if (!state.cancelled) sink.onStatus?.(status)
    },
    onEnd: () => {
      if (!state.cancelled) sink.onEnd()
    },
    onFailure: (failure) => {
      if (!state.cancelled) sink.onFailure(failure)
    },
  }

  // `driveStream` reports through the sink and never rejects.
  void driveStream(path, body, guarded, state)

  return {
    cancel() {
      state.cancelled = true
      transport?.cancel()
      transport = null
    },
  }
}

// Public surface — one function per IPC handler

/** Stream a chat answer. `body` is the request the shared UI built; it is not read here. */
export function streamAiChat(body: unknown, sink: AiStreamSink): AiStreamHandle {
  return startStream('/ai/chat', body, sink)
}

/** Stream an inline completion. */
export function streamAiCompletion(body: unknown, sink: AiStreamSink): AiStreamHandle {
  return startStream('/ai/complete', body, sink)
}

/** The plan's resolved limits, ACU cap and feature flags. */
export function fetchAiEntitlements(): Promise<EdgeAiResult<AIEntitlements>> {
  return call('/me/entitlements', AiEntitlementsSchema)
}

/** What the account has spent against those entitlements. */
export function fetchAiUsage(): Promise<EdgeAiResult<AIUsage>> {
  return call('/me/usage', AiUsageSchema)
}

/** @deprecated Superseded by {@link fetchAiEntitlements} + {@link fetchAiUsage}. */
export function fetchAiCredits(): Promise<EdgeAiResult<AICreditStatus>> {
  return call('/ai/credits', AiCreditStatusSchema)
}

/** Record something the user did. Never rejects. */
export function sendAiTelemetry(event: AITelemetryEventName, data: Record<string, unknown>): Promise<void> {
  return beacon('/ai/telemetry', { event, data })
}

/** Populate the prompt cache before the first request; the route skips the credit guard. */
export function warmAi(): Promise<void> {
  return beacon('/ai/warm')
}

/** The account's conversations for a project, newest first. */
export function listConversations(
  options: { projectId?: string; limit?: number; offset?: number } = {},
): Promise<EdgeAiResult<{ conversations: ConversationSummary[] }>> {
  const params = new URLSearchParams()

  if (options.projectId) params.set('projectId', options.projectId)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))

  const query = params.toString()

  return call(
    `/ai/conversations${query ? `?${query}` : ''}`,
    z.object({ conversations: z.array(ConversationSummarySchema) }),
  )
}

/** One conversation with its full transcript, ordered by turn. */
export function getConversation(id: string): Promise<EdgeAiResult<{ conversation: ConversationDetail }>> {
  return call(`/ai/conversations/${encodeURIComponent(id)}`, z.object({ conversation: ConversationDetailSchema }))
}

/** Reserve an empty conversation before the first message. */
export function createConversation(body: unknown): Promise<EdgeAiResult<{ conversation: ConversationDetail }>> {
  return call('/ai/conversations', z.object({ conversation: ConversationDetailSchema }), { method: 'POST', json: body })
}

/** Retitle a conversation. PATCH, matching the route the web build calls. */
export function renameConversation(
  id: string,
  body: unknown,
): Promise<EdgeAiResult<{ conversation: { id: string; title: string } }>> {
  return call(
    `/ai/conversations/${encodeURIComponent(id)}`,
    z.object({ conversation: z.object({ id: z.string(), title: z.string() }) }),
    { method: 'PATCH', json: body },
  )
}

/** Hard-delete a conversation and its messages. Answers 204 with no body. */
export function deleteConversation(id: string): Promise<EdgeAiResult<null>> {
  return callVoid(`/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
