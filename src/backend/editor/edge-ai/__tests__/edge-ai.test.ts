/**
 * The AI proxy, with the transport stubbed and the parsing real.
 *
 * Two things are worth protecting here, and neither is the request shapes.
 *
 * The first is SSE reassembly. A `data:` frame is not a unit of anything on the wire —
 * it arrives in whatever pieces TCP produced — and a parser that reads chunks instead
 * of lines drops the split frame, which reaches the user as a missing word in the
 * middle of an answer nobody can reproduce.
 *
 * The second is that a frame carrying no prose still reaches the consumer. A
 * `tool_use` is the model saying it wants to act on the project, and a transport that
 * flattens the stream to text drops it — which turns "the assistant built your POU"
 * into "the assistant said nothing and stopped", with no error anywhere to explain it.
 *
 * The third is the failure taxonomy. "You are signed out", "your plan refused this",
 * "the server never answered" and "the model broke" are four different things, and the
 * assistant has a different screen for each. The 402 in particular carries the only
 * payload the exhaustion modal has to work with, so it has to survive the whole trip
 * from the socket to the caller with every field intact.
 */

import type { AISSEEvent } from '../../../../middleware/shared/ports/ai-port'
import { edgeAccessToken, edgeAuthedRequest } from '../../edge-account/edge-account-service'
import type { EdgeStreamHandle, EdgeStreamSink } from '../../edge-account/edge-http'
import { EdgeStreamHttpError, edgeStreamRequest } from '../../edge-account/edge-http'
import type { AiStreamSink, EdgeAiFailure } from '..'
import {
  createConversation,
  deleteConversation,
  fetchAiCredits,
  fetchAiEntitlements,
  fetchAiUsage,
  getConversation,
  listConversations,
  renameConversation,
  sendAiTelemetry,
  streamAiChat,
  streamAiCompletion,
  warmAi,
} from '..'

jest.mock('../../edge-account/edge-account-service', () => ({
  edgeAuthedRequest: jest.fn(),
  edgeAccessToken: jest.fn(),
}))

// Only the transport is stubbed. `EdgeStreamHttpError` and the JSON helpers are the
// real ones, so a body this module should reject is rejected here too rather than
// being waved through by a permissive double.
jest.mock('../../edge-account/edge-http', () => ({
  ...jest.requireActual<typeof import('../../edge-account/edge-http')>('../../edge-account/edge-http'),
  edgeStreamRequest: jest.fn(),
}))

const request = jest.mocked(edgeAuthedRequest)
const token = jest.mocked(edgeAccessToken)
const stream = jest.mocked(edgeStreamRequest)

/** One opened stream: the sink the module handed the transport, and the cancel it got back. */
type OpenedStream = { path: string; accessToken: string | null | undefined; sink: EdgeStreamSink; cancel: jest.Mock }

const opened: OpenedStream[] = []

/** A sink that records what the module decided, in order. */
function recordingSink(): AiStreamSink & { events: AISSEEvent[]; calls: string[]; failures: EdgeAiFailure[] } {
  const events: AISSEEvent[] = []
  const calls: string[] = []
  const failures: EdgeAiFailure[] = []

  return {
    events,
    calls,
    failures,
    onEvent(event) {
      calls.push('event')
      events.push(event)
    },
    onEnd() {
      calls.push('end')
    },
    onFailure(failure) {
      calls.push('failure')
      failures.push(failure)
    },
  }
}

/** Just the prose, for the assertions that are only about reassembly. */
function deltas(events: AISSEEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'content_block_delta' ? [event.delta] : []))
}

/** Let the module's own promise chain run — the token is fetched before the request. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The nth stream the module opened, once it has opened it. */
async function nthStream(index: number): Promise<OpenedStream> {
  for (let attempt = 0; attempt < 50 && opened.length <= index; attempt += 1) {
    await settle()
  }

  const entry = opened[index]

  if (!entry) {
    throw new Error(`No stream opened at index ${index}`)
  }

  return entry
}

function ok(data: unknown, status = 200) {
  return { status, body: JSON.stringify({ statusCode: status, data }) }
}

const ENTITLEMENTS = {
  source: {
    subscriptionId: 's1',
    subscriptionStatus: 'active',
    planSlug: 'pro',
    planDisplayName: 'Pro',
    planLevelSlug: 'plus',
    tier: 2,
  },
  limits: {
    maxOrchestrators: 3,
    maxDevices: null,
    maxPrivateProjects: 10,
    maxPublicProjects: null,
    maxOrgMembers: 5,
    maxTeamWorkspaces: 1,
  },
  acu: { monthlyAcu: 1000, rateLimitWindowHours: 6, rateLimitWindowPercent: 25, marginPercent: null },
  features: { hasAiChat: true, hasVersionControl: false },
}

beforeEach(() => {
  jest.clearAllMocks()
  opened.length = 0

  token.mockResolvedValue('live-token')

  stream.mockImplementation((path, init, sink): EdgeStreamHandle => {
    const cancel = jest.fn()

    opened.push({ path, accessToken: init.accessToken, sink, cancel })

    return { cancel }
  })
})

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

describe('streaming an answer', () => {
  it('reassembles a frame that arrived split across two chunks', async () => {
    const sink = recordingSink()

    streamAiChat({ messages: [] }, sink)

    const { sink: transport } = await nthStream(0)

    // The break falls inside the JSON, which is where a per-chunk parser loses the
    // frame entirely rather than merely mis-ordering it.
    transport.onChunk('data: {"type":"content_block_delta","delta":"Hel')
    transport.onChunk('lo"}\ndata: {"type":"content_block_delta","delta":" world"}\n')

    expect(deltas(sink.events)).toEqual(['Hello', ' world'])
    expect(sink.calls).toEqual(['event', 'event'])
  })

  it('emits a trailing frame that never got its newline', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport } = await nthStream(0)

    transport.onChunk('data: {"type":"content_block_delta","delta":"tail"}')
    transport.onEnd()
    await settle()

    // Dropping it would lose the last words of the answer.
    expect(deltas(sink.events)).toEqual(['tail'])
    expect(sink.calls).toEqual(['event', 'end'])
  })

  it('ends on [DONE] and stops the upstream request there', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport, cancel } = await nthStream(0)

    transport.onChunk('data: {"type":"content_block_delta","delta":"hi"}\ndata: [DONE]\n\n')
    await settle()

    // The sentinel is forwarded too: the consumer sees the frame that ended the
    // stream, not merely the fact that it ended.
    expect(sink.calls).toEqual(['event', 'event', 'end'])
    expect(sink.events.at(-1)).toEqual({ type: 'message_stop', stopReason: undefined })
    // Everything the server generates after the sentinel is billed to someone who
    // will never read it.
    expect(cancel).toHaveBeenCalledTimes(1)

    // A late frame from a connection that has not finished closing is not a second
    // answer.
    transport.onChunk('data: {"type":"content_block_delta","delta":"late"}\n')
    expect(deltas(sink.events)).toEqual(['hi'])
  })

  it('carries a tool call through with its input intact', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport } = await nthStream(0)

    // The arguments are the tool call. A frame that arrives with `input` emptied is
    // worse than one that never arrived: the loop runs the tool against nothing.
    const input = { path: 'programs/main.st', ranges: [{ start: 1, end: 40 }], dryRun: false }

    transport.onChunk(`data: ${JSON.stringify({ type: 'tool_use', id: 't1', name: 'read_pou', input })}\n`)

    expect(sink.events).toEqual([{ type: 'tool_use', id: 't1', name: 'read_pou', input }])
    // A tool call is followed by more of the same answer.
    expect(sink.calls).toEqual(['event'])

    transport.onChunk('data: {"type":"content_block_delta","delta":" done"}\ndata: [DONE]\n')
    await settle()

    expect(sink.calls).toEqual(['event', 'event', 'event', 'end'])
  })

  it('forwards the conversation id ahead of the answer, and keeps reading', async () => {
    const sink = recordingSink()

    streamAiChat({ projectId: 'p1' }, sink)

    const { sink: transport } = await nthStream(0)

    // Sent first when /ai/chat creates the conversation implicitly. Lose it and the
    // next turn of the loop opens a second conversation instead of appending.
    transport.onChunk(
      'data: {"type":"conversation_started","conversationId":"c1","conversationTitle":"Motor control"}\n' +
        'data: {"type":"content_block_delta","delta":"Sure"}\n',
    )
    transport.onEnd()
    await settle()

    expect(sink.events).toEqual([
      { type: 'conversation_started', conversationId: 'c1', conversationTitle: 'Motor control' },
      { type: 'content_block_delta', delta: 'Sure' },
    ])
    expect(sink.calls).toEqual(['event', 'event', 'end'])
  })

  it('drops a frame it cannot read rather than guessing at it', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport } = await nthStream(0)

    transport.onChunk(': heartbeat\n')
    transport.onChunk('data: not json\n')
    // A delta that is not a string would otherwise be concatenated into the answer as
    // `[object Object]`.
    transport.onChunk('data: {"type":"content_block_delta","delta":{"nope":true}}\n')
    // A frame type this build has never heard of is not an error either — the server
    // is free to add one, and an old editor must keep reading past it.
    transport.onChunk('data: {"type":"thinking_delta","delta":"hmm"}\n')
    transport.onEnd()
    await settle()

    expect(sink.calls).toEqual(['end'])
  })

  it('reports an in-band error event as a failure of the model, not of the request', async () => {
    const sink = recordingSink()

    streamAiCompletion({}, sink)

    const { path, sink: transport } = await nthStream(0)

    expect(path).toBe('/ai/complete')

    transport.onChunk('data: {"type":"error","error":"upstream refused"}\n')
    await settle()

    // Forwarded AND terminal: a consumer rendering the transcript sees the frame that
    // ended it, and the caller still gets a failure rather than a silent stop.
    expect(sink.events).toEqual([{ type: 'error', error: 'upstream refused' }])
    expect(sink.calls).toEqual(['event', 'failure'])
    // Status 0: the request itself was accepted, so there is no HTTP status to blame.
    expect(sink.failures).toEqual([{ kind: 'http', status: 0, message: 'upstream refused' }])
  })

  it('hands the 402 billing payload to the caller intact', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport } = await nthStream(0)

    // Wrapped under `error` the way Edge's global exception filter writes it.
    const body = JSON.stringify({
      timestamp: '2026-09-08T00:00:00.000Z',
      path: '/ai/chat',
      statusCode: 402,
      error: {
        error: 'insufficient_acu',
        status: 402,
        message: 'You are out of credits for this month.',
        remaining: 3,
        required: 10,
        monthlyLimit: 1000,
        reactivateUrl: 'https://billing.example/upgrade',
      },
    })

    transport.onError(new EdgeStreamHttpError(402, body))
    await settle()

    expect(sink.failures).toEqual([
      {
        kind: 'billing',
        status: 402,
        message: 'You are out of credits for this month.',
        billing: {
          code: 'insufficient_acu',
          message: 'You are out of credits for this month.',
          remaining: 3,
          required: 10,
          monthlyLimit: 1000,
          reactivateUrl: 'https://billing.example/upgrade',
          subscriptionStatus: undefined,
          resetsAt: undefined,
        },
      },
    ])
  })

  it('treats a structured 429 as billing too, so the same modal can explain it', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport } = await nthStream(0)

    transport.onError(
      new EdgeStreamHttpError(
        429,
        JSON.stringify({
          error: 'rate_limit_exceeded',
          message: 'Too many AI requests in the recent window.',
          resetsAt: '2026-09-08T12:00:00.000Z',
        }),
      ),
    )
    await settle()

    const [failure] = sink.failures

    // `resetsAt` is the only thing that tells the user when to come back.
    expect(failure).toMatchObject({
      kind: 'billing',
      status: 429,
      billing: { code: 'rate_limit_exceeded', resetsAt: '2026-09-08T12:00:00.000Z' },
    })
  })

  it('leaves an unrecognised 429 as an ordinary failure', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport } = await nthStream(0)

    transport.onError(new EdgeStreamHttpError(429, '<html>too many requests</html>'))
    await settle()

    // A proxy's own throttling must not open an exhaustion modal with nothing in it.
    expect(sink.failures).toEqual([{ kind: 'http', status: 429, message: 'Autonomy Edge answered 429.' }])
  })

  it('renews once and retries when a live-looking token is refused', async () => {
    token.mockResolvedValueOnce('stale-token').mockResolvedValueOnce('fresh-token')

    const sink = recordingSink()

    streamAiChat({ messages: [] }, sink)

    const first = await nthStream(0)

    expect(first.accessToken).toBe('stale-token')
    // Revoked from another device, or invalidated by a password change — neither of
    // which the token's own `exp` can reveal.
    first.sink.onError(new EdgeStreamHttpError(401, '{}'))

    const second = await nthStream(1)

    expect(token).toHaveBeenNthCalledWith(2, { forceRenewal: true })
    expect(second.accessToken).toBe('fresh-token')

    second.sink.onChunk('data: {"type":"content_block_delta","delta":"ok"}\ndata: [DONE]\n')
    await settle()

    expect(deltas(sink.events)).toEqual(['ok'])
    expect(sink.calls).toEqual(['event', 'event', 'end'])
  })

  it('gives up as signed out when the retry is refused too', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const first = await nthStream(0)
    first.sink.onError(new EdgeStreamHttpError(401, '{}'))

    const second = await nthStream(1)
    second.sink.onError(new EdgeStreamHttpError(401, '{}'))

    await settle()

    expect(sink.failures).toEqual([{ kind: 'signed-out', message: expect.any(String) }])
    expect(stream).toHaveBeenCalledTimes(2)
  })

  it('says signed out without opening a request when there is no session', async () => {
    token.mockResolvedValue(null)

    const sink = recordingSink()

    streamAiChat({}, sink)
    await settle()

    expect(stream).not.toHaveBeenCalled()
    expect(sink.failures).toEqual([{ kind: 'signed-out', message: expect.any(String) }])
  })

  it('surfaces a transport failure as unreachable, never as a denial', async () => {
    const sink = recordingSink()

    streamAiChat({}, sink)

    const { sink: transport } = await nthStream(0)

    transport.onError(new Error('ECONNRESET'))
    await settle()

    expect(sink.failures).toEqual([{ kind: 'unreachable', message: 'ECONNRESET' }])
  })

  it('reports a renewal that never reached the server as unreachable', async () => {
    token.mockRejectedValue(new Error('offline'))

    const sink = recordingSink()

    streamAiChat({}, sink)
    await settle()

    // Offline is not signed out.
    expect(sink.failures).toEqual([{ kind: 'unreachable', message: 'offline' }])
  })

  it('cancels the upstream request and stops delivering', async () => {
    const sink = recordingSink()

    const handle = streamAiChat({}, sink)

    const { sink: transport, cancel } = await nthStream(0)

    transport.onChunk('data: {"type":"content_block_delta","delta":"partial"}\n')

    handle.cancel()

    expect(cancel).toHaveBeenCalledTimes(1)

    // Nothing is owed to a caller that asked to stop — not even the news that it
    // stopped.
    transport.onChunk('data: {"type":"content_block_delta","delta":"more"}\n')
    transport.onEnd()

    expect(deltas(sink.events)).toEqual(['partial'])
    expect(sink.calls).toEqual(['event'])
  })

  it('honours a cancel that arrives before the request was even opened', async () => {
    let release: (value: string) => void = () => undefined

    token.mockReturnValue(new Promise<string>((resolve) => (release = resolve)))

    const sink = recordingSink()
    const handle = streamAiChat({}, sink)

    handle.cancel()
    release('live-token')
    await settle()

    expect(sink.calls).toEqual([])
  })

  it('posts the body it was given, unread, to the route for its kind', async () => {
    streamAiCompletion({ prefix: 'a', suffix: 'b' }, recordingSink())

    await nthStream(0)

    expect(stream).toHaveBeenCalledWith(
      '/ai/complete',
      expect.objectContaining({ method: 'POST', json: { prefix: 'a', suffix: 'b' }, accessToken: 'live-token' }),
      expect.anything(),
    )
  })
})

// ---------------------------------------------------------------------------
// Buffered routes
// ---------------------------------------------------------------------------

describe('the buffered routes', () => {
  it('reads entitlements out of the envelope', async () => {
    request.mockResolvedValueOnce(ok(ENTITLEMENTS))

    await expect(fetchAiEntitlements()).resolves.toEqual({ ok: true, data: ENTITLEMENTS })
    expect(request).toHaveBeenCalledWith('/me/entitlements', {})
  })

  it('defaults a feature flag it cannot read to off rather than failing the whole read', async () => {
    request.mockResolvedValueOnce(ok({ ...ENTITLEMENTS, features: { hasAiChat: true, hasSomethingNew: 'yes' } }))

    const result = await fetchAiEntitlements()

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({ features: { hasAiChat: true, hasSomethingNew: false } }),
    })
  })

  it('reads usage and credits', async () => {
    const usage = {
      source: ENTITLEMENTS.source,
      orchestrators: { used: 1, limit: 3, remaining: 2 },
      devices: { used: 0, limit: null, remaining: null },
      privateProjects: { used: 2, limit: 10, remaining: 8 },
      publicProjects: { used: 0, limit: null, remaining: null },
      organizations: { used: 0, allowed: true },
      acu: { used: 100, monthlyLimit: 1000, remaining: 900, rateLimitWindowHours: 6, rateLimitWindowPercent: 25 },
    }

    request.mockResolvedValueOnce(ok(usage))
    await expect(fetchAiUsage()).resolves.toEqual({ ok: true, data: usage })
    expect(request).toHaveBeenCalledWith('/me/usage', {})

    const credits = { credits_used: 4, credits_total: 50, tier: 'pro', current_period_end: null }

    request.mockResolvedValueOnce(ok(credits))
    await expect(fetchAiCredits()).resolves.toEqual({ ok: true, data: credits })
    expect(request).toHaveBeenCalledWith('/ai/credits', {})
  })

  it('rejects a 2xx whose body is not the shape it claims to be', async () => {
    request.mockResolvedValueOnce(ok({ source: ENTITLEMENTS.source }))

    // Handing a half-read payload to the UI as if it were whole is the failure this
    // prevents.
    await expect(fetchAiEntitlements()).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 200, message: 'Autonomy Edge returned an unreadable response.' },
    })
  })

  it('says signed out when there is no session to spend', async () => {
    request.mockResolvedValueOnce(null)

    await expect(fetchAiUsage()).resolves.toEqual({
      ok: false,
      failure: { kind: 'signed-out', message: expect.any(String) },
    })
  })

  it('says unreachable when the server never answered', async () => {
    request.mockRejectedValueOnce(new Error('ENOTFOUND'))

    await expect(fetchAiUsage()).resolves.toEqual({ ok: false, failure: { kind: 'unreachable', message: 'ENOTFOUND' } })
  })

  it('carries a billing refusal off a buffered route as well', async () => {
    request.mockResolvedValueOnce({
      status: 402,
      body: JSON.stringify({
        error: 'subscription_inactive',
        message: 'Subscription paused.',
        subscriptionStatus: 'paused',
      }),
    })

    await expect(fetchAiCredits()).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'billing',
        status: 402,
        message: 'Subscription paused.',
        billing: {
          code: 'subscription_inactive',
          message: 'Subscription paused.',
          subscriptionStatus: 'paused',
          remaining: undefined,
          required: undefined,
          monthlyLimit: undefined,
          reactivateUrl: undefined,
          resetsAt: undefined,
        },
      },
    })
  })

  it("reads Nest's validation array into one readable line", async () => {
    request.mockResolvedValueOnce({
      status: 400,
      body: JSON.stringify({ message: ['title too long', 'title required'] }),
    })

    await expect(createConversation({ projectId: 'p1' })).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 400, message: 'title too long; title required' },
    })
  })
})

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

describe('conversations', () => {
  const SUMMARY = { id: 'c1', title: 'Motor control', lastModel: 'sonnet', createdAt: 'then', updatedAt: 'now' }
  const DETAIL = {
    id: 'c1',
    userId: 'u1',
    projectId: 'p1',
    title: 'Motor control',
    lastModel: null,
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        rating: null,
        turnIndex: 0,
        createdAt: 'then',
      },
    ],
    createdAt: 'then',
    updatedAt: 'now',
  }

  it('lists a project’s conversations, scoping the query', async () => {
    request.mockResolvedValueOnce(ok({ conversations: [SUMMARY] }))

    await expect(listConversations({ projectId: 'p1', limit: 10 })).resolves.toEqual({
      ok: true,
      data: { conversations: [SUMMARY] },
    })
    expect(request).toHaveBeenCalledWith('/ai/conversations?projectId=p1&limit=10', {})
  })

  it('reads one transcript', async () => {
    request.mockResolvedValueOnce(ok({ conversation: DETAIL }))

    await expect(getConversation('c1')).resolves.toEqual({ ok: true, data: { conversation: DETAIL } })
    expect(request).toHaveBeenCalledWith('/ai/conversations/c1', {})
  })

  it('creates and renames, on the methods the route expects', async () => {
    request.mockResolvedValueOnce(ok({ conversation: DETAIL }))
    await createConversation({ projectId: 'p1', title: 'Motor control' })

    expect(request).toHaveBeenCalledWith('/ai/conversations', {
      method: 'POST',
      json: { projectId: 'p1', title: 'Motor control' },
    })

    request.mockResolvedValueOnce(ok({ conversation: { id: 'c1', title: 'Renamed' } }))
    await expect(renameConversation('c1', { title: 'Renamed' })).resolves.toEqual({
      ok: true,
      data: { conversation: { id: 'c1', title: 'Renamed' } },
    })

    // PATCH, not POST: the backend route is `@Patch(':conversationId')` and a POST
    // there is a 404 the UI would report as a lost conversation.
    expect(request).toHaveBeenCalledWith('/ai/conversations/c1', { method: 'PATCH', json: { title: 'Renamed' } })
  })

  it('treats the empty 204 from a delete as the success it is', async () => {
    request.mockResolvedValueOnce({ status: 204, body: '' })

    await expect(deleteConversation('c1')).resolves.toEqual({ ok: true, data: null })
    expect(request).toHaveBeenCalledWith('/ai/conversations/c1', { method: 'DELETE' })
  })

  it('still reports a real failure on a delete', async () => {
    request.mockResolvedValueOnce({ status: 403, body: JSON.stringify({ message: 'Not yours' }) })

    await expect(deleteConversation('c1')).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 403, message: 'Not yours' },
    })
  })
})

// ---------------------------------------------------------------------------
// Beacons
// ---------------------------------------------------------------------------

describe('the fire-and-forget routes', () => {
  it('posts telemetry and warms the cache', async () => {
    request.mockResolvedValue({ status: 202, body: '' })

    await sendAiTelemetry('chat_message', { model: 'sonnet' })
    expect(request).toHaveBeenCalledWith('/ai/telemetry', {
      method: 'POST',
      json: { event: 'chat_message', data: { model: 'sonnet' } },
    })

    await warmAi()
    expect(request).toHaveBeenCalledWith('/ai/warm', { method: 'POST', json: undefined })
  })

  it('never rejects, whatever the network does', async () => {
    request.mockRejectedValue(new Error('offline'))

    // An assistant that stops working because a beacon did would be a worse product
    // than one that measures nothing.
    await expect(sendAiTelemetry('completion_shown', {})).resolves.toBeUndefined()
    await expect(warmAi()).resolves.toBeUndefined()
  })
})
