import { createProjectPlcModel } from '@root/frontend/services/plc-model/project-plc-model'
import type { OpenPLCStore } from '@root/frontend/store'
import { createTestStore } from '@root/frontend/store/testing'

import type { HostQueryDispatcher } from '@root/middleware/shared/vendor-document/host-query-handler'
import { installHostQueryHandler } from '@root/middleware/shared/vendor-document/host-query-handler'
import type { HostToRelayMessage, RelayTransport } from '@root/middleware/shared/vendor-document/protocol'
import { RELAY_CHANNEL } from '@root/middleware/shared/vendor-document/protocol'

import { createHostRelayHandler, RELAY_LOCKED_MESSAGE } from '../host-relay-handler'

let store: OpenPLCStore

const PACKAGE = 'vendor-pkg'
const SCREEN = 'module-configuration'

const handler = () =>
  createHostRelayHandler({
    store,
    plcModel: createProjectPlcModel(store),
    packageId: PACKAGE,
    screenId: SCREEN,
  })

const storedData = () => store.getState().projectActions.getVppExtension(PACKAGE, SCREEN)

describe('the vendor screen relay during a debug session (TC11)', () => {
  beforeEach(() => {
    store = createTestStore()
    store.getState().projectActions.setVppExtension(PACKAGE, SCREEN, { slots: ['a'] })
  })

  it('should accept a write from the guest while no debug session is open', () => {
    expect(handler()('setPersistence', [{ slots: ['b'] }])).toBe(true)

    expect(storedData()).toEqual({ slots: ['b'] })
  })

  it('should refuse a write from the guest while the debugger is open', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)

    expect(() => handler()('setPersistence', [{ slots: ['b'] }])).toThrow(RELAY_LOCKED_MESSAGE)
  })

  it('should leave the stored data unchanged when the write is refused', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)

    expect(() => handler()('setPersistence', [{ slots: ['b'] }])).toThrow()

    expect(storedData()).toEqual({ slots: ['a'] })
  })

  it('should still answer a read from the guest while the debugger is open', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)

    expect(handler()('getPersistence', [])).toEqual({ slots: ['a'] })
  })

  it('should accept a write again once the debug session is closed', () => {
    store.getState().workspaceActions.setDebuggerVisible(true)
    store.getState().workspaceActions.clearDebugState()

    expect(handler()('setPersistence', [{ slots: ['b'] }])).toBe(true)
    expect(storedData()).toEqual({ slots: ['b'] })
  })
})

describe('the relay answer the guest receives during a debug session', () => {
  const sendQuery = async () => {
    const posted: HostToRelayMessage[] = []
    let deliver: ((data: unknown) => void) | undefined
    const transport: RelayTransport<HostToRelayMessage> = {
      post: (message) => posted.push(message),
      subscribe: (handler) => {
        deliver = handler
        return () => (deliver = undefined)
      },
    }
    const relay = handler()
    const eagerDispatcher: HostQueryDispatcher = (method, args) => Promise.resolve(relay(method, args))
    const session = installHostQueryHandler(transport, eagerDispatcher)

    deliver?.({
      channel: RELAY_CHANNEL,
      kind: 'host-query',
      id: 'q1',
      method: 'setPersistence',
      args: [{ slots: ['b'] }],
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    session.dispose()

    return posted.filter((message) => message.kind === 'host-response')
  }

  beforeEach(() => {
    store = createTestStore()
    store.getState().projectActions.setVppExtension(PACKAGE, SCREEN, { slots: ['a'] })
    store.getState().workspaceActions.setDebuggerVisible(true)
  })

  it('should answer the refused write instead of leaving the guest waiting', async () => {
    const responses = await sendQuery()

    expect(responses).toHaveLength(1)
  })

  it('should answer with the read-only message', async () => {
    const [response] = await sendQuery()

    expect(response).toMatchObject({ ok: false, error: RELAY_LOCKED_MESSAGE })
  })
})
