/**
 * The AI endpoints of Autonomy Edge, from the desktop main process.
 *
 * Nothing about the assistant runs locally: the prompt, the model, the credit
 * accounting and the conversation history all live on the server, and this module is a
 * proxy onto the same routes the web editor calls, on the same session. That is the
 * point — the desktop and the web build must agree about what a chat costs and what a
 * refusal means, and they only can if there is one implementation of those rules and it
 * is not here.
 *
 * WHY THE MAIN PROCESS. The renderer is not on Edge's origin, and the access token is
 * deliberately never handed to it. The web build authenticates with an `httpOnly`
 * cookie on a shared parent domain and can call the API from the page; the desktop
 * cannot, so the request is made here and the answer is pushed back.
 *
 * WHY RESULTS INSTEAD OF THROWN ERRORS. Every failure here crosses IPC, and a class
 * instance does not survive the structured clone — the prototype is lost and every
 * `instanceof` on the far side quietly answers false. So failures are plain data with a
 * `kind`, exactly as `edge-version-control` does it, and the adapter rebuilds whatever
 * error object the shared UI expects. The `billing` kind is the one that earns its
 * place: the exhaustion modal is driven entirely by the payload it carries.
 */

import { z } from 'zod'

import type { AICreditStatus, AISSEEvent, AITelemetryEventName } from '../../../middleware/shared/ports/ai-port'
import type { AIEntitlements, AIUsage, BillingErrorPayload } from '../../../middleware/shared/ports/types'
import { edgeAccessToken, edgeAuthedRequest } from '../edge-account/edge-account-service'
import type { EdgeStreamHandle } from '../edge-account/edge-http'
import { EdgeStreamHttpError, edgeStreamRequest, parseJsonBody, parseJsonBodyAs } from '../edge-account/edge-http'

// ---------------------------------------------------------------------------
// Result shape — serialisable, because it crosses IPC
// ---------------------------------------------------------------------------

/**
 * Why each of these is kept apart rather than collapsed into a message:
 *
 *  - `signed-out` — there is no session to spend. Nothing is wrong with the request.
 *  - `unreachable` — the server never answered, so NOTHING was learned. Reported as a
 *    denial it would tell someone their credits ran out when their wifi dropped.
 *  - `billing` — the request was refused on cost, and the payload says why and what the
 *    user can do about it. The exhaustion modal is built from nothing else.
 *  - `http` — everything else, with the status, so a 403 reads differently from a 500.
 *
 * Every variant carries a `message`, including the ones a caller is expected to answer
 * by `kind`. A layer in between — the IPC bridge most of all — has to be able to render
 * a failure it has no opinion about without first learning the taxonomy, and a failure
 * with nothing to print reaches the user as an empty toast.
 */
export type EdgeAiFailure =
  | { kind: 'signed-out'; message: string }
  | { kind: 'unreachable'; message: string }
  | { kind: 'billing'; status: number; message: string; billing: BillingErrorPayload }
  | { kind: 'http'; status: number; message: string }

/** No session, phrased once so every route says the same thing. */
const SIGNED_OUT: EdgeAiFailure = { kind: 'signed-out', message: 'Sign in to Autonomy Edge to use the assistant.' }

export type EdgeAiResult<T> = { ok: true; data: T } | { ok: false; failure: EdgeAiFailure }

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/**
 * Every answer arrives wrapped as `{ statusCode, data }` by Nest's global transform
 * interceptor. The wrapper is validated here and the payload by the schema each route
 * passes in, so a 2xx carrying a body this build does not understand is reported as
 * unreadable rather than handed to the renderer as if it were the expected shape.
 */
const edgeEnvelopeOf = <Schema extends z.ZodTypeAny>(data: Schema) =>
  z.object({ statusCode: z.number().optional(), data: data.optional() })

/** A `message` field as Nest's exception filter writes it. */
const FailureBodySchema = z.object({ message: z.union([z.string(), z.array(z.string())]).nullish() })

const SubscriptionStatusSchema = z.enum(['trialing', 'active', 'past_due', 'paused', 'canceled', 'expired'])

/**
 * Feature flags gate whole panels of the UI, and the backend is explicitly free to add
 * new ones. `.catch(false)` per value rather than a strict boolean map: a single flag
 * that arrives in a shape this build does not expect must not take the entitlements
 * read down with it, and "off" is the safe direction for a flag nobody can read.
 */
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
// No `satisfies z.ZodType<AIEntitlements>` on this one: `PlanFeatures` declares its
// index signature as `boolean | undefined`, which a schema producing plain booleans
// cannot round-trip through zod's invariant input type. The conformance is enforced
// where it counts anyway — on `fetchAiEntitlements`'s declared return type.

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

/**
 * A message's `content` is left as opaque blocks on purpose. It holds text, `tool_use`
 * and `tool_result` entries whose shape belongs to the chat UI that renders them, and
 * naming that shape in the transport would mean two definitions to keep in step for no
 * decision made here.
 */
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

// ---------------------------------------------------------------------------
// Failure reading
// ---------------------------------------------------------------------------

/**
 * Pull something readable out of a failure body.
 *
 * Nest's exception filter puts the reason in `message`, which may be a string or an
 * array of validation strings — and Edge's `GlobalExceptionFilter` then wraps the
 * whole thing as `{ timestamp, path, method, statusCode, error: <original body> }`,
 * so on the wire the reason sits one level down, under `error`. Both levels are read,
 * wrapped first: the wrapped shape is what the API sends, the bare one is what the
 * guard throws and what its own tests assert against.
 *
 * Reading the root alone was how every non-billing 4xx and 5xx reached the desktop
 * user as `Autonomy Edge answered 400.` — the 400 from `@ArrayMaxSize(100)` on
 * `messages`, the 404 for an account with no subscription, the 403 for an org whose
 * access was revoked — while the web build, which reads the body text, showed the
 * real sentence. `parseBillingPayload` below already unwrapped; this did not.
 *
 * Falling back to the status keeps the UI from showing an empty toast when a proxy
 * answers with HTML.
 */
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

/**
 * The refusal Edge's `CreditGuard` raises. Only the three codes it can throw count as
 * billing; anything else on the same status is an ordinary failure, so a proxy's own
 * 402 cannot open an exhaustion modal with nothing in it.
 *
 * Fields are individually forgiving — a `remaining` that arrives as a string costs the
 * user a number in the modal, while failing the whole parse would cost them the modal.
 * `subscriptionStatus` is the exception: it selects the copy the modal shows, and a
 * value outside the known set would select none.
 */
const BillingPayloadSchema = z.object({
  // The four the CreditGuard throws — `credit.guard.ts` in autonomy-edge. `past_due` is
  // the one that was missing: a lapsed card produced a 402 this build could not read,
  // so the exhaustion modal never opened and the user got no way to fix their payment.
  error: z.enum(['insufficient_acu', 'subscription_inactive', 'rate_limit_exceeded', 'subscription_past_due']),
  message: z.string().catch('Credit limit reached.'),
  remaining: z.number().optional().catch(undefined),
  required: z.number().optional().catch(undefined),
  monthlyLimit: z.number().optional().catch(undefined),
  subscriptionStatus: SubscriptionStatusSchema.optional().catch(undefined),
  reactivateUrl: z.string().url().optional().catch(undefined),
  resetsAt: z.string().nullable().optional().catch(undefined),
})

/**
 * Edge's `GlobalExceptionFilter` re-wraps a thrown `HttpException` as
 * `{ timestamp, path, method, statusCode, error: <original body> }`, so the structured
 * payload sits one level down. Both shapes are read: the wrapped one is what the API
 * actually sends, and the bare one is what the guard throws, which is what the
 * backend's own tests assert against.
 */
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

/**
 * A status the server chose, turned into the failure the UI branches on.
 *
 * 429 joins 402 in `billing` when it carries a recognised payload: the rolling usage
 * window is spent for the same reason the monthly cap is, the modal that explains it is
 * the same modal, and the `resetsAt` it carries is the only thing that tells the user
 * when to come back. A 429 with no such body stays an ordinary HTTP failure.
 */
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

// ---------------------------------------------------------------------------
// Buffered routes
// ---------------------------------------------------------------------------

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
    // A rejection from `edgeAuthedRequest` means no answer at all — see edge-http's
    // contract. This is the one branch that must not be reported as a denial.
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

  // Deleting a conversation answers 204 with no body at all. That is a success, so the
  // unreadable-body check in `call` has to be relaxed here rather than turning an empty
  // success into an error.
  if (!result.ok && result.failure.kind === 'http' && result.failure.status < 400) {
    return { ok: true, data: null }
  }

  return result.ok ? { ok: true, data: null } : result
}

/**
 * Fire a request nobody is waiting on.
 *
 * Never rejects and reports nothing: both callers are beacons whose failure is of no
 * consequence to the user, and a rejected promise escaping into an IPC handler would
 * be. Returned rather than voided so a test can wait for it to land.
 */
async function beacon(path: string, json?: unknown): Promise<void> {
  try {
    await edgeAuthedRequest(path, { method: 'POST', json })
  } catch {
    // Best effort by definition.
  }
}

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * Every event `/ai/chat` and `/ai/complete` can put on the wire.
 *
 * Validated rather than trusted: an SSE frame is a JSON document from the network like
 * any other, and a `delta` that arrives as an object would otherwise be concatenated
 * into the user's answer as `[object Object]`.
 */
const SseEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('content_block_delta'), delta: z.string() }),
  z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('message_stop'), stopReason: z.string().optional() }),
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('conversation_started'), conversationId: z.string(), conversationTitle: z.string() }),
])

type AiSseEvent = z.infer<typeof SseEventSchema>

/**
 * The parsed frame as the port declares it.
 *
 * Built by hand rather than passed straight through, and the reason is narrow: zod
 * infers any key whose type admits `undefined` as OPTIONAL, so `input: z.unknown()`
 * produces `input?: unknown` while the contract says the key is always there. Naming
 * each field is how that gap closes without an assertion — and the `switch` is
 * exhaustive, so a frame added to the schema and not to the contract is a compile
 * error here rather than a frame that silently never arrives.
 */
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

/**
 * Where a streamed answer is delivered.
 *
 * Exactly one of {@link onEnd} and {@link onFailure} is called, once. Cancelling calls
 * neither: a caller that asked to stop is not waiting to be told the stop happened.
 */
export interface AiStreamSink {
  /**
   * One frame of the answer, in order, structured.
   *
   * Not flattened to text here, and that is the whole point: a `tool_use` frame is
   * how the model says it wants to act on the project, and a transport that drops it
   * turns "the assistant built your POU" into "the assistant said nothing and stopped"
   * — with no error anywhere. Flattening to prose is the adapter's job, above this.
   */
  onEvent(event: AISSEEvent): void
  /**
   * The upstream HTTP status, once, before any delta — diagnostic only. Optional
   * because nothing about reading an answer depends on it: a refusal never produces a
   * chunk, so the status a consumer would act on already reaches it as a failure.
   */
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

/**
 * Read one SSE line.
 *
 * `[DONE]` is Edge's end-of-stream sentinel and is not JSON, so it is recognised before
 * anything tries to parse it. A line that is not a `data:` frame — a comment, a blank
 * separator, a heartbeat — carries nothing this caller needs.
 */
function parseSseLine(line: string): AiSseEvent | null {
  if (!line.startsWith('data: ')) {
    return null
  }

  const data = line.slice('data: '.length)

  if (data === '[DONE]') {
    return { type: 'message_stop' }
  }

  const parsed = SseEventSchema.safeParse(parseJsonBody(data))

  // A frame of a type this build does not know is dropped here, on purpose. The web
  // client forwards it, but on the web the consumer is in the same process and can
  // ignore what it does not recognise; here the frame would have to cross IPC as a
  // typed `AISSEEvent`, and there is no member of that union for it to travel as.
  // Edge emits exactly the five types above today, so nothing is lost; the day it
  // emits a sixth, this schema is the one place to teach it.
  return parsed.success ? parsed.data : null
}

/**
 * Turn arbitrary chunk boundaries back into whole SSE lines.
 *
 * TCP has no idea what a line is: a single `data:` frame routinely arrives as two
 * chunks, and two frames routinely arrive as one. Parsing per chunk would drop the
 * split frame and with it a piece of the user's answer, so the tail of a chunk is held
 * until the newline that completes it turns up.
 */
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

      // The last piece is only a whole line if the chunk happened to end on a newline,
      // in which case it is the empty string and harvests nothing.
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

/**
 * Act on one event.
 *
 * Returns the outcome that ends the stream, or null to keep reading.
 */
function applyEvent(event: AiSseEvent, sink: AiStreamSink): StreamOutcome | null {
  // Forwarded first, whatever it is. `error` and `message_stop` also end the stream
  // below, but the consumer still gets to see the frame that ended it.
  sink.onEvent(toWireEvent(event))

  switch (event.type) {
    case 'content_block_delta':
      return null

    case 'error':
      // Status 0: the request itself succeeded and the model failed partway through
      // generating, so there is no HTTP status to blame. Same reading the web client
      // gives it.
      return { kind: 'failed', failure: { kind: 'http', status: 0, message: event.error } }

    case 'message_stop':
      return { kind: 'done' }

    case 'tool_use':
    case 'conversation_started':
      // Both are forwarded above and neither ends the stream: a tool call is followed
      // by more of the same answer, and the conversation id arrives before any of it.
      return null
  }
}

/** Idle budget for an AI answer. Generous, because the model's pace is not a failure. */
const AI_STREAM_IDLE_TIMEOUT_MS = 120_000

/**
 * One streamed attempt on one token. Never rejects — the outcome is the answer.
 *
 * `adopt` hands the transport handle out as soon as it exists, so a cancel arriving
 * mid-answer reaches the socket rather than waiting for a stream that will not end on
 * its own.
 */
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
      // The server keeps generating until the socket goes, and every token it generates
      // after `message_stop` is billed to someone who will never see it.
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
          // A stream that ends without `[DONE]` may still have a frame in the buffer —
          // dropping it would lose the last words of the answer.
          consume(reader.flush())
          settle({ kind: 'done' })
        },
        onError: (error) => {
          if (!(error instanceof EdgeStreamHttpError)) {
            settle({ kind: 'failed', failure: { kind: 'unreachable', message: error.message } })

            return
          }

          // Kept apart from the other statuses so the caller can renew and try again.
          // Nothing has been emitted at this point: a refusal is never streamed.
          settle(error.status === 401 ? { kind: 'unauthorized' } : failed(error))
        },
      },
    )

    if (stopped) {
      // The transport refused before it returned — a cleartext base URL reports through
      // the sink rather than throwing, so the handle arrives already spent.
      handle.cancel()

      return
    }

    adopt(handle)
  })
}

function failed(error: EdgeStreamHttpError): StreamOutcome {
  return { kind: 'failed', failure: failureFromStatus(error.status, error.body) }
}

/**
 * Drive a stream to its end, renewing once if the token turns out to be dead.
 *
 * This is the streaming twin of the retry inside `edgeAuthedRequest`, and it exists for
 * the same reason: a token's `exp` cannot tell us it was revoked from another device.
 * The retry is safe to make because a 401 arrives before any text does, so nothing has
 * reached the user that a second attempt would repeat.
 */
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
    // `edgeAccessToken` rejects when the renewal never reached the server. Offline is
    // not signed out.
    sink.onFailure({ kind: 'unreachable', message: error instanceof Error ? error.message : 'No answer' })
  }
}

interface StreamState {
  cancelled: boolean
  adopt: (handle: EdgeStreamHandle) => void
}

/**
 * Start a stream and hand back the way to stop it.
 *
 * Synchronous on purpose although the token is not: the IPC layer has to be able to
 * file the handle under a stream id before it can possibly be asked to cancel it, and a
 * cancel that arrives while the token is still being fetched has to be honoured
 * anyway — which is what `cancelled` is for.
 */
function startStream(path: string, body: unknown, sink: AiStreamSink): AiStreamHandle {
  let transport: EdgeStreamHandle | null = null

  const state: StreamState = {
    cancelled: false,
    adopt: (handle) => {
      transport = handle
    },
  }

  // Nothing is owed to a caller that stopped listening, so every callback is gated
  // rather than each call site having to remember.
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

  // `driveStream` reports through the sink and never rejects, so there is nothing left
  // to await or to handle here.
  void driveStream(path, body, guarded, state)

  return {
    cancel() {
      state.cancelled = true
      transport?.cancel()
      transport = null
    },
  }
}

// ---------------------------------------------------------------------------
// Public surface — one function per IPC handler
// ---------------------------------------------------------------------------

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

/**
 * The legacy credit summary.
 *
 * @deprecated Superseded by {@link fetchAiEntitlements} + {@link fetchAiUsage}. The
 * route now delegates to the same entitlements service server-side and survives only
 * as a fallback while call sites migrate.
 */
export function fetchAiCredits(): Promise<EdgeAiResult<AICreditStatus>> {
  return call('/ai/credits', AiCreditStatusSchema)
}

/**
 * Record something the user did.
 *
 * Resolves either way and never rejects: telemetry that fails is not a fact the user
 * needs, and an assistant that stops working because a beacon did would be a worse
 * product than one that measures nothing.
 */
export function sendAiTelemetry(event: AITelemetryEventName, data: Record<string, unknown>): Promise<void> {
  return beacon('/ai/telemetry', { event, data })
}

/**
 * Populate Anthropic's prompt cache ahead of the first real request.
 *
 * Costs nothing (the route skips the credit guard) and saves the first completion the
 * cold-cache latency the user would otherwise read as the feature being slow.
 */
export function warmAi(): Promise<void> {
  return beacon('/ai/warm')
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

/**
 * The account's conversations for a project, newest first.
 *
 * `projectId` is what scopes them; the route rejects a listing without one, so a call
 * with no project is a call with nothing to list.
 */
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
