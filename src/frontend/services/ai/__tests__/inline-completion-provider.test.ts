/**
 * The inline completion provider is the piece of the AI feature the user meets
 * on every keystroke, and almost everything it protects against is invisible
 * when it breaks: a suggestion logged as shown that Monaco never painted, a
 * cached completion served after the variables it referenced were deleted, a
 * duplicated closing paren, ghost text that renders as an empty line.
 *
 * The AI port is a hand-built fake and the real store is seeded, so nothing
 * here mocks a module and the file runs under jest (editor) and vitest (web)
 * alike. Timers are faked so the 300 ms request debounce and the 5 s stream
 * timeout cost nothing; the two cases that depend on how long a suggestion was
 * *visible* run on real timers instead, because that measurement is taken from
 * `performance.now()` and the two runners fake it differently.
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import type * as monaco from 'monaco-editor'

import type { AICompleteParams, AIPort } from '../../../../middleware/shared/ports/ai-port'
import type { EdgeSessionState } from '../../../../middleware/shared/ports/edge-account-port'
import type { BillingErrorPayload, PLCPou, PLCVariable } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { setImeComposing } from '../ime-state'
import { AIInlineCompletionProvider } from '../inline-completion-provider'

// ---------------------------------------------------------------------------
// Fake AI port
// ---------------------------------------------------------------------------

type TelemetryCall = { event: string; data: Record<string, unknown> }
type CompletionStream = (params: AICompleteParams, signal?: AbortSignal) => AsyncGenerator<string, void, unknown>

type FakePort = {
  port: AIPort
  /** Requests the provider actually sent, in order. */
  requests: AICompleteParams[]
  telemetry: TelemetryCall[]
}

/**
 * A port that answers completions and nothing else. Every other method throws
 * rather than returning a benign default — a provider quietly reaching for
 * chat or credits on a keystroke is itself the defect.
 */
function makePort(stream: CompletionStream): FakePort {
  const requests: AICompleteParams[] = []
  const telemetry: TelemetryCall[] = []
  const unreachable = () => {
    throw new Error('the completion provider must not call this')
  }
  const port: AIPort = {
    isFeatureEnabled: true,
    hasUserConsented: true,
    inlineCompletionsEnabled: true,
    streamCompletion(params, signal) {
      requests.push(params)
      return stream(params, signal)
    },
    streamChat: unreachable,
    streamChatEvents: unreachable,
    fetchEntitlements: unreachable,
    fetchUsage: unreachable,
    fetchCredits: unreachable,
    sendTelemetry(event, data) {
      telemetry.push({ event, data })
    },
  }
  return { port, requests, telemetry }
}

/** A stream that yields the given chunks and finishes. */
function yielding(...chunks: string[]): CompletionStream {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async function* () {
    for (const chunk of chunks) yield chunk
  }
}

/** A stream that never produces a token, ending only when the signal aborts. */
const neverYields: CompletionStream = async function* (_params, signal) {
  await new Promise<void>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })))
  })
}

/** A stream that fails before the first token. */
function failingWith(error: unknown): CompletionStream {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async function* () {
    throw error
  }
}

function eventsNamed(telemetry: TelemetryCall[], event: string): TelemetryCall[] {
  return telemetry.filter((call) => call.event === event)
}

// ---------------------------------------------------------------------------
// Monaco fakes
//
// `ITextModel`, `Position`, `CancellationToken` and `InlineCompletionContext`
// have far more surface than the provider touches; faking them whole would be
// noise, so each assertion is confined to one helper below.
// ---------------------------------------------------------------------------

function makeEditableModel(initial: string, uri = 'file:///test.st') {
  let text = initial
  const model = {
    getValue: () => text,
    getOffsetAt: (pos: { lineNumber: number; column: number }) => {
      const lines = text.split('\n')
      let offset = 0
      for (let i = 0; i < pos.lineNumber - 1; i++) offset += lines[i].length + 1
      return offset + pos.column - 1
    },
    getLineContent: (line: number) => text.split('\n')[line - 1] ?? '',
    uri: { toString: () => uri },
  }
  return {
    model: model as unknown as monaco.editor.ITextModel,
    setText: (next: string) => {
      text = next
    },
  }
}

function makeModel(text: string, uri = 'file:///test.st'): monaco.editor.ITextModel {
  return makeEditableModel(text, uri).model
}

function makePosition(lineNumber: number, column: number): monaco.Position {
  return { lineNumber, column } as unknown as monaco.Position
}

function makeToken(): { token: monaco.CancellationToken; cancel: () => void } {
  const listeners: Array<() => void> = []
  const state = { cancelled: false }
  const token = {
    get isCancellationRequested() {
      return state.cancelled
    },
    onCancellationRequested: (listener: () => void) => {
      listeners.push(listener)
      return { dispose: () => undefined }
    },
  }
  return {
    token: token as unknown as monaco.CancellationToken,
    cancel: () => {
      state.cancelled = true
      for (const listener of listeners) listener()
    },
  }
}

const inlineContext = {} as monaco.languages.InlineCompletionContext

// ---------------------------------------------------------------------------
// Store seeding
// ---------------------------------------------------------------------------

function makeVariable(name: string): PLCVariable {
  return { name, class: 'local', type: { definition: 'base-type', value: 'INT' }, location: '', documentation: '' }
}

function makePou(name: string, vars: PLCVariable[] = []): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: vars },
    body: { language: 'st', value: '' },
    documentation: '',
  }
}

function seedPous(pous: PLCPou[]): void {
  const current = openPLCStoreBase.getState().project
  openPLCStoreBase.getState().projectActions.setProject({
    ...current,
    data: {
      ...current.data,
      pous,
      dataTypes: [],
      configurations: { resource: { tasks: [], instances: [], globalVariables: [] } },
    },
  })
}

/** Start a request and let the 300 ms debounce elapse on the fake clock. */
function provide(
  provider: AIInlineCompletionProvider,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  token: monaco.CancellationToken = makeToken().token,
): Promise<monaco.languages.InlineCompletions> {
  const pending = provider.provideInlineCompletions(model, position, inlineContext, token)
  return vi.advanceTimersByTimeAsync(300).then(() => pending)
}

beforeEach(() => {
  vi.useFakeTimers()
  const state = openPLCStoreBase.getState()
  state.aiActions.setAIEnabled(true)
  state.aiActions.setPreference('inlineCompletionsEnabled', true)
  state.aiActions.setBillingError(null)
  seedPous([makePou('Main')])
})

afterEach(() => {
  vi.useRealTimers()
  setImeComposing(false)
})

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('gates before any request', () => {
  it('asks for nothing while the AI feature is off', async () => {
    openPLCStoreBase.getState().aiActions.setAIEnabled(false)
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(result.items).toHaveLength(0)
    expect(requests).toHaveLength(0)
    provider.dispose()
  })

  it('asks for nothing while the user has inline suggestions turned off', async () => {
    openPLCStoreBase.getState().aiActions.setPreference('inlineCompletionsEnabled', false)
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(result.items).toHaveLength(0)
    expect(requests).toHaveLength(0)
    provider.dispose()
  })

  it('stays out of the way during IME composition', async () => {
    // Intermediate composition characters (CJK) are not typing; reading them
    // as type-through divergence would cancel the suggestion mid-word.
    setImeComposing(true)
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(result.items).toHaveLength(0)
    expect(requests).toHaveLength(0)
    provider.dispose()
  })

  it('asks for nothing in a completely empty editor', async () => {
    // With no code at all there is nothing to complete from, and the request
    // would spend a model call on an empty prompt.
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel(''), makePosition(1, 1))

    expect(result.items).toHaveLength(0)
    expect(requests).toHaveLength(0)
    provider.dispose()
  })
})

// ---------------------------------------------------------------------------
// The network path
// ---------------------------------------------------------------------------

describe('network completions', () => {
  it('joins the streamed chunks into one suggestion anchored at the cursor', async () => {
    const { port, telemetry } = makePort(yielding('hello', ' world'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(result.items).toHaveLength(1)
    expect(result.items[0].insertText).toBe('hello world')
    expect(result.items[0].range).toEqual({
      startLineNumber: 1,
      startColumn: 6,
      endLineNumber: 1,
      endColumn: 6,
    })
    expect(eventsNamed(telemetry, 'completion_requested')).toHaveLength(1)
    expect(eventsNamed(telemetry, 'completion_shown')[0].data).toMatchObject({ source: 'network' })
    provider.dispose()
  })

  it('sends the FIM context the builder produced, not the raw document', async () => {
    // The model is completing a body, but it needs the POU wrapper to know
    // what it is inside — that is what the request must carry.
    seedPous([makePou('Main', [makeVariable('speed')])])
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(requests[0].prefix).toContain('PROGRAM Main')
    expect(requests[0].suffix).toContain('END_PROGRAM')
    expect(requests[0].language).toBe('st')
    expect(requests[0].projectContext).toContain('speed')
    provider.dispose()
  })

  it.each([
    ['a markdown fence', ['```st\n', 'x := 1;\n', '```'], 'x := 1;'],
    ['an echoed COMPLETION wrapper', ['<COMPLETION>x := 1;</COMPLETION>'], 'x := 1;'],
    ['leading blank lines', ['\n\n  y := 2;'], '  y := 2;'],
  ])('strips %s the model added around the code', async (_label, chunks, expected) => {
    // A completion that begins with a blank line renders as an invisible ghost
    // at the cursor — the user reads it as "no suggestion".
    const { port } = makePort(yielding(...chunks))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(result.items[0].insertText).toBe(expected)
    provider.dispose()
  })

  it.each([
    ['no_tokens', []],
    ['whitespace_only', ['   ']],
  ])('reports an empty completion as %s rather than showing nothing silently', async (reason, chunks) => {
    // The two shapes are different backend problems; collapsing them would
    // hide "the model returned nothing at all" behind "it returned whitespace".
    const { port, telemetry } = makePort(yielding(...chunks))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(result.items).toHaveLength(0)
    expect(eventsNamed(telemetry, 'completion_empty')[0].data).toMatchObject({ reason })
    provider.dispose()
  })

  it.each([
    ['mid-line, where only a short expression fits', 'x := ;', 5, 64],
    ['right after an assignment', 'x := ', 6, 96],
    ['at the start of a fresh line', 'a := 1;\n', 1, 256],
  ])('caps output tokens %s', async (_label, text, column, maxTokens) => {
    // Capping output cuts total stream time without touching time-to-first-token.
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const lineNumber = text.endsWith('\n') ? 2 : 1

    await provide(provider, makeModel(text), makePosition(lineNumber, column))

    expect(requests[0].maxTokens).toBe(maxTokens)
    provider.dispose()
  })
})

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

describe('cancellation', () => {
  it('never reaches the network when a keystroke supersedes the request during the debounce', async () => {
    // This is what makes the completion we log as shown the one Monaco paints:
    // superseded calls die in the debounce window instead of racing.
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const { token, cancel } = makeToken()

    const pending = provider.provideInlineCompletions(makeModel('x := '), makePosition(1, 6), inlineContext, token)
    cancel()
    await vi.advanceTimersByTimeAsync(300)

    expect((await pending).items).toHaveLength(0)
    expect(requests).toHaveLength(0)
    provider.dispose()
  })

  it('returns nothing and caches nothing when the request is superseded mid-stream', async () => {
    // Returning a stale suggestion here is the "completion_shown but nothing
    // painted" bug; caching it would also poison type-through afterwards.
    const { token, cancel } = makeToken()
    const { port, requests } = makePort(
      // eslint-disable-next-line @typescript-eslint/require-await
      async function* () {
        yield 'hello'
        cancel()
      },
    )
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const first = await provide(provider, makeModel('x := '), makePosition(1, 6), token)
    const second = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(first.items).toHaveLength(0)
    // The second call had to go back to the network, proving nothing was cached.
    expect(requests).toHaveLength(2)
    provider.dispose()
  })

  it('aborts an in-flight request when the provider is disposed', async () => {
    const { port } = makePort(neverYields)
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const pending = provider.provideInlineCompletions(
      makeModel('x := '),
      makePosition(1, 6),
      inlineContext,
      makeToken().token,
    )
    await vi.advanceTimersByTimeAsync(300)
    provider.dispose()

    expect((await pending).items).toHaveLength(0)
  })

  it('gives up and reports a timeout when no first token arrives', async () => {
    const { port, telemetry } = makePort(neverYields)
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const pending = provider.provideInlineCompletions(
      makeModel('x := '),
      makePosition(1, 6),
      inlineContext,
      makeToken().token,
    )
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(5000)

    expect((await pending).items).toHaveLength(0)
    expect(eventsNamed(telemetry, 'completion_timeout')[0].data).toMatchObject({ timeoutMs: 5000 })
    // An aborted request never counted as requested, so it must not be logged
    // as an error on top of the timeout.
    expect(eventsNamed(telemetry, 'completion_error')).toHaveLength(0)
    provider.dispose()
  })
})

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

describe('cache', () => {
  it('serves a revisited cursor position without asking the model again', async () => {
    const { port, requests, telemetry } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const model = makeModel('x := ')

    await provide(provider, model, makePosition(1, 6))
    const second = await provide(provider, model, makePosition(1, 6))

    expect(second.items[0].insertText).toBe('hello')
    expect(requests).toHaveLength(1)
    expect(eventsNamed(telemetry, 'completion_shown')[1].data).toMatchObject({ source: 'cache' })
    provider.dispose()
  })

  it('drops cached completions when the project changes under them', async () => {
    // A suggestion referencing a variable the user just deleted is worse than
    // no suggestion — it compiles to nothing and reads as the assistant lying.
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const model = makeModel('x := ')
    await provide(provider, model, makePosition(1, 6))

    seedPous([makePou('Main', [makeVariable('speed')])])
    await provide(provider, model, makePosition(1, 6))

    expect(requests).toHaveLength(2)
    provider.dispose()
  })

  it('drops cached completions when the user turns inline suggestions off', async () => {
    // Nothing stale may resurface the moment they turn the feature back on.
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const model = makeModel('x := ')
    await provide(provider, model, makePosition(1, 6))

    openPLCStoreBase.getState().aiActions.setPreference('inlineCompletionsEnabled', false)
    openPLCStoreBase.getState().aiActions.setPreference('inlineCompletionsEnabled', true)
    await provide(provider, model, makePosition(1, 6))

    expect(requests).toHaveLength(2)
    provider.dispose()
  })

  it('evicts the oldest entry once the cache is full instead of growing unbounded', async () => {
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    // 17 distinct cursor positions in one long line; the cache holds 16.
    const model = makeModel('x'.repeat(40))

    for (let column = 2; column <= 18; column++) await provide(provider, model, makePosition(1, column))
    const revisited = await provide(provider, model, makePosition(1, 2))

    expect(revisited.items[0].insertText).toBe('hello')
    // 17 cold requests plus one more for the evicted first position.
    expect(requests).toHaveLength(18)
    provider.dispose()
  })
})

// ---------------------------------------------------------------------------
// Type-through
// ---------------------------------------------------------------------------

describe('type-through', () => {
  it('shrinks the ghost text as the user types it, with no new request', async () => {
    const { port, requests, telemetry } = makePort(yielding('hello world'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    const typed = await provide(provider, makeModel('x := hel'), makePosition(1, 9))

    expect(typed.items).toHaveLength(1)
    // Monaco strips the common prefix, so only " lo world" paints as ghost text.
    expect(typed.items[0].insertText).toBe('hello world')
    expect(typed.items[0].range).toMatchObject({ startColumn: 6, endColumn: 9 })
    expect(requests).toHaveLength(1)
    expect(eventsNamed(telemetry, 'completion_shown').at(-1)?.data).toMatchObject({
      source: 'type_through',
      matchedChars: 3,
      completionLength: 11,
    })
    provider.dispose()
  })

  it('reports the type-through impression once, not on every keystroke', async () => {
    const { port, telemetry } = makePort(yielding('hello world'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    await provide(provider, makeModel('x := he'), makePosition(1, 8))
    await provide(provider, makeModel('x := hel'), makePosition(1, 9))

    expect(eventsNamed(telemetry, 'completion_shown').filter((c) => c.data.source === 'type_through')).toHaveLength(1)
    provider.dispose()
  })

  it('tolerates a tab typed where the suggestion had spaces', async () => {
    // Editors re-indent as you type; a whitespace difference is not the user
    // rejecting the suggestion.
    const { port, requests } = makePort(yielding('a\tbc'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    const typed = await provide(provider, makeModel('x := a b'), makePosition(1, 9))

    expect(typed.items[0].insertText).toBe('a bc')
    expect(requests).toHaveLength(1)
    provider.dispose()
  })

  it('stops suggesting once the whole suggestion has been typed', async () => {
    const { port } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    const done = await provide(provider, makeModel('x := hello'), makePosition(1, 11))

    expect(done.items).toHaveLength(0)
    provider.dispose()
  })

  it('does not duplicate a closing paren the editor already inserted', async () => {
    // Monaco auto-closes `(`; without reconciliation the ghost text would show
    // a second `)` the user then has to delete (VS Code #170527).
    const { port } = makePort(yielding('foo(a)'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    const typed = await provide(provider, makeModel('x := foo()'), makePosition(1, 10))

    expect(typed.items[0].insertText).toBe('foo(a')
    provider.dispose()
  })

  it('asks again once the user types something the suggestion does not contain', async () => {
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    await provide(provider, makeModel('x := hey'), makePosition(1, 9))

    expect(requests).toHaveLength(2)
    provider.dispose()
  })

  it('does not compare against a suggestion anchored on another line', async () => {
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    await provide(provider, makeModel('x := \ny := '), makePosition(2, 6))

    expect(requests).toHaveLength(2)
    provider.dispose()
  })

  it('does not compare against a suggestion the cursor has backtracked past', async () => {
    const { port, requests } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    await provide(provider, makeModel('x := '), makePosition(1, 6))

    await provide(provider, makeModel('x := '), makePosition(1, 3))

    expect(requests).toHaveLength(2)
    provider.dispose()
  })
})

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

describe('failures', () => {
  it('fails silently in the editor but records why', async () => {
    // Inline completion has no error UI by design; the telemetry is the only
    // way a broken backend becomes visible.
    const { port, telemetry } = makePort(failingWith(Object.assign(new Error('boom'), { status: 500 })))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    const result = await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(result.items).toHaveLength(0)
    expect(eventsNamed(telemetry, 'completion_error')[0].data).toMatchObject({
      errorType: 'api_error',
      statusCode: 500,
    })
    provider.dispose()
  })

  it('classifies an error carrying no status by its name', async () => {
    const { port, telemetry } = makePort(failingWith(new TypeError('bad shape')))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(eventsNamed(telemetry, 'completion_error')[0].data).toMatchObject({ errorType: 'TypeError' })
    provider.dispose()
  })

  it('classifies a thrown non-Error as unknown rather than crashing on error.name', async () => {
    const { port, telemetry } = makePort(failingWith('just a string'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(eventsNamed(telemetry, 'completion_error')[0].data).toMatchObject({ errorType: 'unknown' })
    provider.dispose()
  })

  it('persists a 402 on the slice so the exhaustion modal has one source of truth', async () => {
    // Completion itself stays silent, but the same billing block would gate
    // chat — the next chat interaction must pop the modal.
    const billing: BillingErrorPayload = {
      code: 'insufficient_acu',
      message: 'Out of ACU',
      remaining: 0,
      required: 12,
      monthlyLimit: 613,
    }
    const { port } = makePort(failingWith(Object.assign(new Error('Out of ACU'), { status: 402, billing })))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(openPLCStoreBase.getState().ai.billingError).toEqual(billing)
    provider.dispose()
  })

  it('does not record a 402 with no payload to act on', async () => {
    const { port } = makePort(failingWith(Object.assign(new Error('payment required'), { status: 402 })))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    await provide(provider, makeModel('x := '), makePosition(1, 6))

    expect(openPLCStoreBase.getState().ai.billingError).toBeNull()
    provider.dispose()
  })
})

// ---------------------------------------------------------------------------
// A signed-out account
// ---------------------------------------------------------------------------

/** A session whose expiry can be flipped, and whose restore listeners can be fired. */
function makeSession(): {
  session: EdgeSessionState
  expire: (v: boolean) => void
  restore: () => void
  listeners: () => number
} {
  let expired = false
  const restored = new Set<() => void>()
  const session: EdgeSessionState = {
    isExpired: () => expired,
    isAbsent: () => false,
    onExpired: () => () => undefined,
    onRestored: (listener) => {
      restored.add(listener)
      return () => restored.delete(listener)
    },
    markRestored: () => undefined,
  }
  return {
    session,
    expire: (value) => {
      expired = value
    },
    restore: () => restored.forEach((listener) => listener()),
    listeners: () => restored.size,
  }
}

const refused = () => Object.assign(new Error('Sign in to Autonomy Edge to use the assistant.'), { status: 401 })

describe('a signed-out account', () => {
  it('stops asking after a 401 and asks again once the backoff has elapsed', async () => {
    const { port, requests, telemetry } = makePort(failingWith(refused()))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    await provide(provider, makeModel('x := '), makePosition(1, 6))
    expect(requests).toHaveLength(1)
    const telemetryAfterRefusal = telemetry.length

    // Every keystroke inside the hold costs nothing: no round trip, no telemetry.
    await provide(provider, makeModel('x := 1'), makePosition(1, 7))
    expect(requests).toHaveLength(1)
    expect(telemetry).toHaveLength(telemetryAfterRefusal)

    await vi.advanceTimersByTimeAsync(30_000)
    await provide(provider, makeModel('x := 12'), makePosition(1, 8))
    expect(requests).toHaveLength(2)
    provider.dispose()
  })

  it('widens the hold on each refusal and resets it once a request goes through', async () => {
    let refuse = true
    const stream: CompletionStream = async function* () {
      await Promise.resolve()
      if (refuse) throw refused()
      yield 'ok'
    }
    const { port, requests } = makePort(stream)
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    await provide(provider, makeModel('a := '), makePosition(1, 6))
    await vi.advanceTimersByTimeAsync(30_000)
    await provide(provider, makeModel('b := '), makePosition(1, 6))
    expect(requests).toHaveLength(2)

    // The second refusal holds for twice as long.
    await vi.advanceTimersByTimeAsync(30_000)
    await provide(provider, makeModel('c := '), makePosition(1, 6))
    expect(requests).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(30_000)
    refuse = false
    await provide(provider, makeModel('d := '), makePosition(1, 6))
    expect(requests).toHaveLength(3)

    // Back to the shortest hold after a success.
    refuse = true
    await provide(provider, makeModel('e := '), makePosition(1, 6))
    await vi.advanceTimersByTimeAsync(30_000)
    await provide(provider, makeModel('f := '), makePosition(1, 6))
    expect(requests).toHaveLength(5)
    provider.dispose()
  })

  it('holds while the session says it is expired, and resumes the moment it is restored', async () => {
    const { session, expire, restore, listeners } = makeSession()
    const { port, requests } = makePort(failingWith(refused()))
    const provider = new AIInlineCompletionProvider('Main', 'st', port, session)

    expire(true)
    await provide(provider, makeModel('x := '), makePosition(1, 6))
    expect(requests).toHaveLength(0)

    expire(false)
    await provide(provider, makeModel('x := 1'), makePosition(1, 7))
    expect(requests).toHaveLength(1)

    // Refused, so held — until the session is restored, with no wait.
    await provide(provider, makeModel('x := 12'), makePosition(1, 8))
    expect(requests).toHaveLength(1)
    restore()
    await provide(provider, makeModel('x := 123'), makePosition(1, 9))
    expect(requests).toHaveLength(2)

    provider.dispose()
    expect(listeners()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Accept / dismiss accounting
//
// These read how long the suggestion was visible, which comes from
// `performance.now()`; jest and vitest fake that differently, so the clock here
// is the real one.
// ---------------------------------------------------------------------------

describe('accept and dismiss accounting', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function show(provider: AIInlineCompletionProvider, model: monaco.editor.ITextModel) {
    return provider.provideInlineCompletions(model, makePosition(1, 6), inlineContext, makeToken().token)
  }

  it('counts a completion as accepted when the line now contains it', async () => {
    const { port, telemetry } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const editable = makeEditableModel('x := ')
    await show(provider, editable.model)

    editable.setText('x := hello')
    provider.freeInlineCompletions({ items: [] })

    expect(eventsNamed(telemetry, 'completion_accepted')[0].data).toMatchObject({ completionLength: 5 })
    provider.dispose()
  })

  it('counts a completion the user read and rejected as dismissed', async () => {
    const { port, telemetry } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const editable = makeEditableModel('x := ')
    await show(provider, editable.model)

    await sleep(350)
    provider.disposeInlineCompletions({ items: [] })

    expect(eventsNamed(telemetry, 'completion_dismissed')).toHaveLength(1)
    provider.dispose()
  })

  it('ignores a completion replaced before the user could read it', async () => {
    // A suggestion superseded by the next keystroke is not a rejection; counting
    // it would drown the dismissal signal in noise.
    const { port, telemetry } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const editable = makeEditableModel('x := ')
    await show(provider, editable.model)

    editable.setText('y := ')
    provider.disposeInlineCompletions({ items: [] })

    expect(eventsNamed(telemetry, 'completion_dismissed')).toHaveLength(0)
    expect(eventsNamed(telemetry, 'completion_accepted')).toHaveLength(0)
    provider.dispose()
  })

  it('records nothing when no completion was ever shown', async () => {
    const { port, telemetry } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)

    provider.freeInlineCompletions({ items: [] })

    expect(telemetry).toHaveLength(0)
    await Promise.resolve()
    provider.dispose()
  })

  it('still counts a dismissal when the model it was shown in is gone', async () => {
    // The editor can be torn down before Monaco releases the completion;
    // losing the impression to a throw would silently skew the accept rate.
    const { port, telemetry } = makePort(yielding('hello'))
    const provider = new AIInlineCompletionProvider('Main', 'st', port)
    const broken = {
      getValue: () => 'x := ',
      getOffsetAt: () => 5,
      getLineContent: (line: number) => {
        if (line === 1) return 'x := '
        return ''
      },
      uri: { toString: () => 'file:///gone.st' },
    }
    const model = broken as unknown as monaco.editor.ITextModel
    await show(provider, model)

    broken.getLineContent = () => {
      throw new Error('model disposed')
    }
    await sleep(350)
    provider.disposeInlineCompletions({ items: [] })

    expect(eventsNamed(telemetry, 'completion_dismissed')).toHaveLength(1)
    provider.dispose()
  })
})
