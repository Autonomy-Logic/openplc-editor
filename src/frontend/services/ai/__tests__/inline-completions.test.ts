import { beforeEach, describe, expect, it } from '@jest/globals'
import type * as monaco from 'monaco-editor'

import type { AIPort } from '../../../../middleware/shared/ports/ai-port'
import { isImeComposing, setImeComposing } from '../ime-state'
import { __resetInlineCompletionsForTests, registerAIInlineCompletions } from '../inline-completions'

type FakeEditor = { onDidCompositionStart: (cb: () => void) => void; onDidCompositionEnd: (cb: () => void) => void }

function makePort(warmCache: () => void): AIPort {
  const unreachable = () => {
    throw new Error('registration must not call this')
  }
  return {
    isFeatureEnabled: true,
    hasUserConsented: true,
    inlineCompletionsEnabled: true,
    streamCompletion: unreachable,
    streamChat: unreachable,
    streamChatEvents: unreachable,
    fetchEntitlements: unreachable,
    fetchUsage: unreachable,
    fetchCredits: unreachable,
    sendTelemetry: () => undefined,
    warmCache,
  }
}

// Latches are module-level and once-per-session; reset so each case starts unwarmed.
beforeEach(() => {
  __resetInlineCompletionsForTests()
})

describe('registerAIInlineCompletions', () => {
  it('warms once, wires IME once, and disposes both halves', () => {
    let warmCalls = 0
    const port = makePort(() => {
      warmCalls += 1
    })

    const compositionStarts: Array<() => void> = []
    const compositionEnds: Array<() => void> = []
    const makeEditor = (): FakeEditor => ({
      onDidCompositionStart: (cb) => compositionStarts.push(cb),
      onDidCompositionEnd: (cb) => compositionEnds.push(cb),
    })
    const existingEditor = makeEditor()

    let registrationDisposed = 0
    let onCreateEditor: ((editor: FakeEditor) => void) | undefined
    let getEditorsCalls = 0

    const fakeMonaco = {
      languages: {
        registerInlineCompletionsProvider: (_language: string, _provider: unknown) => ({
          dispose: () => {
            registrationDisposed += 1
          },
        }),
      },
      editor: {
        getEditors: () => {
          getEditorsCalls += 1
          return [existingEditor]
        },
        onDidCreateEditor: (cb: (editor: FakeEditor) => void) => {
          onCreateEditor = cb
        },
      },
    } as unknown as typeof monaco

    const registration = registerAIInlineCompletions(port, {
      monacoInstance: fakeMonaco,
      pouName: 'Main',
      language: 'st',
    })

    expect(warmCalls).toBe(1)
    expect(getEditorsCalls).toBe(1)

    // The composition listeners are real: firing them moves the IME flag, which
    // is what suppresses type-through while a CJK composition is open.
    setImeComposing(false)
    compositionStarts[0]()
    expect(isImeComposing()).toBe(true)
    compositionEnds[0]()
    expect(isImeComposing()).toBe(false)

    // An editor opened later gets the same treatment.
    const futureEditor = makeEditor()
    onCreateEditor?.(futureEditor)
    expect(compositionStarts).toHaveLength(2)

    registration.dispose()
    expect(registrationDisposed).toBe(1)

    // Second registration: neither latch fires again.
    const second = registerAIInlineCompletions(port, {
      monacoInstance: fakeMonaco,
      pouName: 'Other',
      language: 'st',
    })
    expect(warmCalls).toBe(1)
    expect(getEditorsCalls).toBe(1)
    second.dispose()
  })

  it('does not require the platform to support cache warming', () => {
    const port = makePort(() => undefined)
    delete port.warmCache

    const fakeMonaco = {
      languages: { registerInlineCompletionsProvider: () => ({ dispose: () => undefined }) },
      editor: { getEditors: () => [], onDidCreateEditor: () => undefined },
    } as unknown as typeof monaco

    const registration = registerAIInlineCompletions(port, {
      monacoInstance: fakeMonaco,
      pouName: 'Main',
      language: 'st',
    })
    expect(registration.dispose).toBeInstanceOf(Function)
    registration.dispose()
  })
})
