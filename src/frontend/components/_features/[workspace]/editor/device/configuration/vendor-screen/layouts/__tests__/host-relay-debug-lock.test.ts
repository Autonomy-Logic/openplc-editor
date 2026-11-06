import { createProjectPlcModel } from '@root/frontend/services/plc-model/project-plc-model'
import type { OpenPLCStore } from '@root/frontend/store'
import { createTestStore } from '@root/frontend/store/testing'

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

    try {
      handler()('setPersistence', [{ slots: ['b'] }])
    } catch {
      // the refusal is the point; the assertion is on the data
    }

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
