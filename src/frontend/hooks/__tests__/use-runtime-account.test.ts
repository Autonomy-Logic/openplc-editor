import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimeUserRole, WhoAmIResult } from '@root/middleware/shared/ports/runtime-port'
import { act, renderHook, waitFor } from '@testing-library/react'

import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestPorts, createTestStore } from '../../store/testing'
import { useRuntimeAccount } from '../use-runtime-account'

let store: OpenPLCStore
let reportedRole: RuntimeUserRole
let whoAmICalls: number
let clearCalls: number
let tokenRefreshed: (() => void) | null
let sessionEnded: (() => void) | null

function renderAccountHook() {
  const ports = createTestPorts({
    capabilities: EDITOR_CAPABILITIES,
    runtime: {
      whoAmI: () => {
        whoAmICalls += 1
        return Promise.resolve<WhoAmIResult>({ success: true, user: { id: 4, username: 'op', role: reportedRole } })
      },
      clearCredentials: () => {
        clearCalls += 1
        return Promise.resolve({ success: true })
      },
      onTokenRefreshed: (callback) => {
        tokenRefreshed = () => callback('tok-2')
        return () => {
          tokenRefreshed = null
        }
      },
      onSessionEnded: (callback) => {
        sessionEnded = callback
        return () => {
          sessionEnded = null
        }
      },
    },
  })
  return renderHook(() => useRuntimeAccount(), { wrapper: createStoreWrapper(store, ports) })
}

function connect(): void {
  const { deviceActions } = store.getState()
  deviceActions.setRuntimeIpAddress('10.0.0.9')
  deviceActions.setRuntimeJwtToken('tok-1')
  deviceActions.setRuntimeConnectionStatus('connected')
}

beforeEach(() => {
  store = createTestStore()
  reportedRole = 'operator'
  whoAmICalls = 0
  clearCalls = 0
  tokenRefreshed = null
  sessionEnded = null
})

describe('useRuntimeAccount', () => {
  it('reads the role on connect and clears it on disconnect', async () => {
    renderAccountHook()
    expect(whoAmICalls).toBe(0)

    act(() => connect())
    await waitFor(() => expect(store.getState().runtimeConnection.accountRole).toBe('operator'))

    act(() => store.getState().deviceActions.setRuntimeConnectionStatus('disconnected'))
    expect(store.getState().runtimeConnection.accountRole).toBeNull()
  })

  it('reads the role again after a re-sign-in, so a role changed elsewhere is followed', async () => {
    renderAccountHook()
    act(() => connect())
    await waitFor(() => expect(store.getState().runtimeConnection.accountRole).toBe('operator'))

    reportedRole = 'engineer'
    act(() => tokenRefreshed?.())
    await waitFor(() => expect(store.getState().runtimeConnection.accountRole).toBe('engineer'))
    expect(whoAmICalls).toBe(2)
  })

  it('disconnects with a notice when the runtime refuses to sign the account in again', async () => {
    renderAccountHook()
    act(() => connect())
    await waitFor(() => expect(store.getState().runtimeConnection.accountRole).toBe('operator'))

    act(() => sessionEnded?.())
    await waitFor(() => expect(clearCalls).toBe(1))

    const { runtimeConnection, modals } = store.getState()
    expect(runtimeConnection.connectionStatus).toBe('disconnected')
    expect(runtimeConnection.accountRole).toBeNull()
    expect(modals['runtime-connection-lost']?.open).toBe(true)
  })

  it('unsubscribes on unmount', () => {
    const { unmount } = renderAccountHook()
    expect(tokenRefreshed).not.toBeNull()
    expect(sessionEnded).not.toBeNull()
    unmount()
    expect(tokenRefreshed).toBeNull()
    expect(sessionEnded).toBeNull()
  })
})
