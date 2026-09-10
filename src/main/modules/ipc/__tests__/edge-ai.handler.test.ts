/**
 * What the `edge-ai:*` channels refuse, and what they clean up.
 *
 * Two different hazards live here. The first is the one every edge channel has:
 * the renderer is not a trusted caller, so an argument that is not what it
 * claims to be has to be REFUSED rather than forwarded — a conversation id read
 * as `undefined` becomes a request about a conversation by that name.
 *
 * The second is specific to streaming. A stream is the only thing in this bridge
 * that outlives its `invoke`: main holds the open upstream request in a map, and
 * anything that leaves an entry behind — an abort that does not delete, a window
 * closed mid-answer — is a socket nobody will ever close and tokens being pushed
 * at a `webContents` that would throw on receiving them.
 */

import type { EdgeAiFailure } from '@root/backend/editor/edge-ai'
import {
  createConversation,
  deleteConversation,
  getConversation,
  renameConversation,
  sendAiTelemetry,
  streamAiChat,
  streamAiCompletion,
} from '@root/backend/editor/edge-ai'
import type { AISSEEvent } from '@root/middleware/shared/ports/ai-port'

import { logger } from '../../../../backend/editor/services'
import MainProcessBridge from '../main'

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => '/tmp') },
  dialog: {},
  nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
  shell: { openExternal: jest.fn() },
}))

jest.mock('@root/backend/editor/edge-ai', () => ({
  createConversation: jest.fn(),
  deleteConversation: jest.fn(),
  fetchAiCredits: jest.fn(),
  fetchAiEntitlements: jest.fn(),
  fetchAiUsage: jest.fn(),
  getConversation: jest.fn(),
  listConversations: jest.fn(),
  renameConversation: jest.fn(),
  sendAiTelemetry: jest.fn(),
  streamAiChat: jest.fn(),
  streamAiCompletion: jest.fn(),
  warmAi: jest.fn(),
}))

jest.mock('@root/backend/editor/edge-version-control', () => ({}))
jest.mock('@root/backend/editor/edge-projects', () => ({}))
jest.mock('@root/backend/editor/edge-project-upload', () => ({}))
jest.mock('@root/backend/editor/edge-account/edge-account-service', () => ({}))
jest.mock('@root/backend/editor/ethercat', () => ({ ESIService: jest.fn() }))
jest.mock('@root/backend/editor/library-manager/desktop-catalog-transport', () => ({
  createDesktopCatalogTransport: jest.fn(() => ({})),
}))
jest.mock('@root/backend/editor/utils/runtime-https-config', () => ({ getRuntimeHttpsOptions: jest.fn(() => ({})) }))
jest.mock('@root/backend/shared/ethercat/esi-parser-main', () => ({ parseESIDeviceFull: jest.fn() }))
jest.mock('@root/backend/shared/library/public-catalog-client', () => ({ listPublicLibraries: jest.fn() }))
jest.mock('../../../../backend/editor/library-manager', () => ({
  LibraryManagerModule: jest.fn(() => ({ loadEnabledArchives: jest.fn(() => ({ archives: [], missing: [] })) })),
}))
jest.mock('../../../../backend/editor/package-manager', () => ({ PackageManagerModule: jest.fn(() => ({})) }))
jest.mock('../../../../backend/editor/services', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('../../../../backend/editor/utils', () => ({
  getOpenProjectPath: jest.fn(),
  getProjectPath: jest.fn(),
}))
jest.mock('../../../../backend/shared/simulator/simulator-module', () => ({
  SimulatorModule: jest.fn(() => ({ stop: jest.fn() })),
}))

const chat = jest.mocked(streamAiChat)
const completion = jest.mocked(streamAiCompletion)
const conversation = jest.mocked(getConversation)
const create = jest.mocked(createConversation)
const rename = jest.mocked(renameConversation)
const remove = jest.mocked(deleteConversation)
const telemetry = jest.mocked(sendAiTelemetry)

const bridge = new MainProcessBridge({
  ipcMain: {},
  mainWindow: { isDestroyed: jest.fn(() => false), isMaximized: jest.fn(() => false) },
  projectService: {},
  store: { get: jest.fn(() => undefined) },
  menuBuilder: {},
  pouService: {},
  compilerModule: {},
  hardwareModule: {},
} as never)

/** The sink the edge-ai module is handed — captured so a test can play the model's part. */
type Sink = {
  onEvent: (event: AISSEEvent) => void
  onEnd: () => void
  onFailure: (failure: EdgeAiFailure) => void
}

/** One text delta, the frame every other assertion here is not about. */
const delta = (text: string): AISSEEvent => ({ type: 'content_block_delta', delta: text })

/** The window a stream feeds, standing in for a real `webContents`. */
const makeSender = () => ({
  send: jest.fn(),
  isDestroyed: jest.fn(() => false),
  once: jest.fn(),
  removeListener: jest.fn(),
})

type Sender = ReturnType<typeof makeSender>

const cancel = jest.fn()

/** Start a chat stream and hand back everything the assertions need. */
const startChat = (sender: Sender = makeSender()) => {
  chat.mockImplementation(() => ({ cancel }))

  const started = bridge.handleEdgeAiStreamStart({ sender } as never, {
    kind: 'chat',
    body: { messages: [{ role: 'user', content: 'hi' }] },
  })

  const call = chat.mock.calls[0]
  const sink: Sink = call === undefined ? (undefined as never) : call[1]
  const streamId = started.ok ? started.data.streamId : ''

  return { sender, sink, streamId }
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('starting a stream', () => {
  it.each([
    ['no arguments at all', undefined],
    ['a kind the bridge does not serve', { kind: 'transcribe', body: {} }],
    ['a missing kind', { body: {} }],
    ['a body that is not an object', { kind: 'chat', body: 'hello' }],
    ['a body that is a list', { kind: 'chat', body: [] }],
    ['no body at all', { kind: 'chat' }],
  ])('is refused for %s', (_label, params) => {
    // Refused rather than defaulted: a completion started as a chat, or a chat
    // POSTed with an empty body, comes back from Edge as a confusing 400 and
    // still costs the round trip.
    expect(bridge.handleEdgeAiStreamStart({ sender: makeSender() } as never, params)).toMatchObject({
      ok: false,
      failure: { kind: 'http', status: 400 },
    })

    expect(chat).not.toHaveBeenCalled()
    expect(completion).not.toHaveBeenCalled()
  })

  it('answers with an id the renderer did not choose', () => {
    const { streamId } = startChat()

    expect(streamId).toEqual(expect.any(String))
    expect(streamId.length).toBeGreaterThan(0)
  })

  it('routes a completion to the completion endpoint', () => {
    completion.mockImplementation(() => ({ cancel }))

    bridge.handleEdgeAiStreamStart({ sender: makeSender() } as never, { kind: 'completion', body: { prefix: 'a' } })

    expect(completion).toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })

  it('tags every event with the id so two answers at once stay apart', () => {
    const { sender, sink, streamId } = startChat()

    sink.onEvent(delta('tok'))
    sink.onEnd()

    expect(sender.send).toHaveBeenNthCalledWith(1, 'edge-ai:event', { streamId, event: delta('tok') })
    expect(sender.send).toHaveBeenNthCalledWith(2, 'edge-ai:end', { streamId })
  })

  it('carries a tool_use frame over with its input intact', () => {
    const { sender, sink, streamId } = startChat()

    sink.onEvent({
      type: 'tool_use',
      id: 'toolu_01',
      name: 'write_pou',
      input: { pouName: 'Main', body: 'a := 1;', variables: [{ name: 'a', type: 'INT' }] },
    })

    // This is the frame the channel is structured FOR. Flattened to text it reads
    // as nothing at all: the renderer cannot run a call it never saw, so the
    // assistant answers and then silently does not act. The expectation is spelled
    // out rather than compared against the object that was sent, because a
    // transport that kept `name` and dropped `input` would still look right.
    expect(sender.send).toHaveBeenCalledWith('edge-ai:event', {
      streamId,
      event: {
        type: 'tool_use',
        id: 'toolu_01',
        name: 'write_pou',
        input: { pouName: 'Main', body: 'a := 1;', variables: [{ name: 'a', type: 'INT' }] },
      },
    })
  })

  it('forwards a failure whole, so the renderer still knows which kind it was', () => {
    const { sender, sink, streamId } = startChat()
    const failure: EdgeAiFailure = { kind: 'signed-out', message: 'Sign in to use the assistant.' }

    sink.onFailure(failure)

    // Flattened to a message, `signed-out` and `unreachable` would both read as
    // "the AI is broken" — one wants a sign-in prompt, the other wants patience.
    expect(sender.send).toHaveBeenCalledWith('edge-ai:error', { streamId, failure })
  })

  it('leaves nothing behind when the request cannot even be made', () => {
    const sender = makeSender()
    chat.mockImplementation(() => {
      throw new Error('no network stack')
    })

    const started = bridge.handleEdgeAiStreamStart({ sender } as never, { kind: 'chat', body: { messages: [] } })

    // The map entry and the teardown hook are in place before the call — a throw
    // that skipped the sink would otherwise leave a stream nothing can ever end.
    expect(started).toMatchObject({ ok: false, failure: { kind: 'unreachable' } })
    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function))
  })
})

describe('aborting a stream', () => {
  it('cancels the upstream request and forgets the stream', () => {
    const { sender, sink, streamId } = startChat()

    expect(bridge.handleEdgeAiStreamAbort({} as never, streamId)).toMatchObject({ ok: true })
    expect(cancel).toHaveBeenCalledTimes(1)

    // The entry is gone, so a token still in flight when the user hit stop is
    // dropped instead of being pushed at a panel that has moved on.
    sink.onEvent(delta('too late'))
    expect(sender.send).not.toHaveBeenCalled()

    // And a second abort finds nothing to cancel — the map no longer holds it.
    bridge.handleEdgeAiStreamAbort({} as never, streamId)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an id that already ended, not a failure', () => {
    const { sink, streamId } = startChat()

    sink.onEnd()

    expect(bridge.handleEdgeAiStreamAbort({} as never, streamId)).toMatchObject({ ok: true })
    // The stream finished on its own; cancelling a completed request is not ours to do.
    expect(cancel).not.toHaveBeenCalled()
  })

  it('is refused without an id rather than treated as "abort everything"', () => {
    startChat()

    expect(bridge.handleEdgeAiStreamAbort({} as never, undefined)).toMatchObject({
      ok: false,
      failure: { kind: 'http', status: 400 },
    })
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('a window that goes away mid-answer', () => {
  it('is never sent to, and takes its stream with it', () => {
    const { sender, sink } = startChat()

    sender.isDestroyed.mockReturnValue(true)
    sink.onEvent(delta('tok'))

    // `send` on a destroyed webContents throws, and there is nobody left to read
    // the answer — so the chunk is dropped AND the request is cancelled.
    expect(sender.send).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)

    // Cleaned up once: the stream is out of the map, so the next token finds nothing.
    sink.onEvent(delta('tok'))
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('is noticed on teardown, not only when the next token arrives', () => {
    const { sender } = startChat()

    // A stream that has produced nothing yet would otherwise sit there holding an
    // open request until the model spoke — which, for a stalled request, is never.
    const [event, onDestroyed] = sender.once.mock.calls[0] ?? []
    expect(event).toBe('destroyed')
    if (typeof onDestroyed === 'function') onDestroyed()

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('unhooks the teardown listener when the stream ends normally', () => {
    // The window outlives the stream, so a listener left behind is one more dead
    // closure per answer on a long-lived webContents.
    const { sender, sink } = startChat()

    sink.onEnd()

    expect(sender.removeListener).toHaveBeenCalledWith('destroyed', expect.any(Function))
  })
})

describe('the conversation channels', () => {
  it.each([
    ['get', (id: unknown) => bridge.handleEdgeAiConversationsGet({} as never, id), () => conversation],
    ['delete', (id: unknown) => bridge.handleEdgeAiConversationsDelete({} as never, id), () => remove],
    ['rename', (id: unknown) => bridge.handleEdgeAiConversationsRename({} as never, id, { title: 'x' }), () => rename],
  ])('refuse %s without an id', async (_label, invoke, target) => {
    // An id interpolated into a path as `undefined` asks Edge about a conversation
    // by that name — a 404 that reads like the conversation was deleted.
    await expect(invoke(undefined)).resolves.toMatchObject({ ok: false, failure: { status: 400 } })
    await expect(invoke('')).resolves.toMatchObject({ ok: false, failure: { status: 400 } })
    await expect(invoke(42)).resolves.toMatchObject({ ok: false, failure: { status: 400 } })

    expect(target()).not.toHaveBeenCalled()
  })

  it.each([
    ['create', (body: unknown) => bridge.handleEdgeAiConversationsCreate({} as never, body), () => create],
    ['rename', (body: unknown) => bridge.handleEdgeAiConversationsRename({} as never, 'c1', body), () => rename],
  ])('refuse %s without a body', async (_label, invoke, target) => {
    await expect(invoke(undefined)).resolves.toMatchObject({ ok: false, failure: { status: 400 } })
    await expect(invoke('a title')).resolves.toMatchObject({ ok: false, failure: { status: 400 } })

    expect(target()).not.toHaveBeenCalled()
  })

  it('forward a well-formed rename untouched', async () => {
    await bridge.handleEdgeAiConversationsRename({} as never, 'c1', { title: 'Motor start-up' })

    expect(rename).toHaveBeenCalledWith('c1', { title: 'Motor start-up' })
  })
})

describe('telemetry', () => {
  it('refuses an event name this build does not know, and says so in the log', async () => {
    await expect(bridge.handleEdgeAiTelemetry({} as never, 'chat_messge', {})).resolves.toMatchObject({
      ok: false,
      failure: { status: 400 },
    })

    // The allowlist is a copy of the port's union, so the likeliest refusal is an
    // event added there and not here. Nobody notices a graph that was never drawn
    // — the log line is the only trace a dropped event leaves.
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('chat_messge'))
  })

  it('forwards an event it knows', async () => {
    await expect(bridge.handleEdgeAiTelemetry({} as never, 'chat_message', { model: 'sonnet' })).resolves.toMatchObject(
      { ok: true },
    )

    expect(telemetry).toHaveBeenCalledWith('chat_message', { model: 'sonnet' })
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
