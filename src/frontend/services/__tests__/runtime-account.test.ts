import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { RuntimePort, UpdateUserParams, WhoAmIResult } from '@root/middleware/shared/ports/runtime-port'

import type { OpenPLCStore } from '../../store'
import { createTestPorts, createTestStore } from '../../store/testing'
import {
  disconnectEndedRuntimeSession,
  refreshRuntimeAccount,
  sessionEndedNotice,
  updateOwnRuntimeAccount,
} from '../runtime-account'

type RuntimeAccountPort = Pick<RuntimePort, 'whoAmI' | 'updateOwnAccount' | 'clearCredentials'>

function fakeRuntime(overrides: Partial<RuntimeAccountPort> = {}) {
  const calls: string[] = []
  const updates: Array<{ userId: number; params: UpdateUserParams }> = []
  const port: RuntimeAccountPort = {
    whoAmI: () => {
      calls.push('whoAmI')
      return Promise.resolve<WhoAmIResult>({ success: true, user: { id: 7, username: 'op', role: 'operator' } })
    },
    updateOwnAccount: (userId, params) => {
      updates.push({ userId, params })
      return Promise.resolve({ success: true })
    },
    clearCredentials: () => {
      calls.push('clearCredentials')
      return Promise.resolve({ success: true })
    },
    ...overrides,
  }
  return { port, calls, updates }
}

function asRuntime(port: RuntimeAccountPort): RuntimePort {
  return createTestPorts({ capabilities: EDITOR_CAPABILITIES, runtime: port }).runtime
}

let store: OpenPLCStore

function connect(): void {
  const { deviceActions } = store.getState()
  deviceActions.setRuntimeIpAddress('10.0.0.5')
  deviceActions.setRuntimeJwtToken('tok')
  deviceActions.setRuntimeConnectionStatus('connected')
  deviceActions.setStoredCredentials({ username: 'op', password: 'old-pass' })
}

beforeEach(() => {
  store = createTestStore()
})

describe('refreshRuntimeAccount', () => {
  it('keeps the role whoami reports in the store', async () => {
    connect()
    const { port } = fakeRuntime()
    const user = await refreshRuntimeAccount(store, asRuntime(port))
    expect(user).toEqual({ id: 7, username: 'op', role: 'operator' })
    expect(store.getState().runtimeConnection.accountRole).toBe('operator')
  })

  it('follows a role change on the next read', async () => {
    connect()
    store.getState().deviceActions.setRuntimeAccountRole('operator')
    const { port } = fakeRuntime({
      whoAmI: () => Promise.resolve({ success: true, user: { id: 7, username: 'op', role: 'viewer' } }),
    })
    await refreshRuntimeAccount(store, asRuntime(port))
    expect(store.getState().runtimeConnection.accountRole).toBe('viewer')
  })

  it('leaves the role as it was when whoami fails', async () => {
    connect()
    store.getState().deviceActions.setRuntimeAccountRole('operator')
    const { port } = fakeRuntime({ whoAmI: () => Promise.resolve({ success: false, error: 'boom' }) })
    expect(await refreshRuntimeAccount(store, asRuntime(port))).toBeNull()
    expect(store.getState().runtimeConnection.accountRole).toBe('operator')
  })

  it('does not ask the runtime when not connected', async () => {
    const { port, calls } = fakeRuntime()
    expect(await refreshRuntimeAccount(store, asRuntime(port))).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('disconnectEndedRuntimeSession', () => {
  it('disconnects, forgets the session and says why', async () => {
    connect()
    store.getState().deviceActions.setRuntimeAccountRole('operator')
    const { port, calls } = fakeRuntime()

    await disconnectEndedRuntimeSession(store, asRuntime(port))

    const { runtimeConnection, modals } = store.getState()
    expect(runtimeConnection.connectionStatus).toBe('disconnected')
    expect(runtimeConnection.jwtToken).toBeNull()
    expect(runtimeConnection.accountRole).toBeNull()
    expect(runtimeConnection.storedCredentials).toBeNull()
    expect(calls).toEqual(['clearCredentials'])
    expect(modals['runtime-connection-lost']?.open).toBe(true)
    expect(modals['runtime-connection-lost']?.data).toEqual({
      label: '10.0.0.5',
      body: sessionEndedNotice('10.0.0.5'),
    })
    expect(sessionEndedNotice('10.0.0.5')).toContain('your account was deleted or its password was changed')
  })

  it('does nothing when already disconnected', async () => {
    const { port, calls } = fakeRuntime()
    await disconnectEndedRuntimeSession(store, asRuntime(port))
    expect(calls).toEqual([])
    expect(store.getState().modals['runtime-connection-lost']?.open ?? false).toBe(false)
  })
})

describe('updateOwnRuntimeAccount', () => {
  it('changes the account through the port and keeps the stored credentials in step', async () => {
    connect()
    const { port, updates } = fakeRuntime()
    const params = { password: 'new-pass', currentPassword: 'old-pass' }

    const result = await updateOwnRuntimeAccount(store, asRuntime(port), 7, params)

    expect(result).toEqual({ success: true })
    expect(updates).toEqual([{ userId: 7, params }])
    expect(store.getState().runtimeConnection.storedCredentials).toEqual({ username: 'op', password: 'new-pass' })
    expect(store.getState().runtimeConnection.connectionStatus).toBe('connected')
  })

  it('leaves the stored credentials alone when the runtime refuses', async () => {
    connect()
    const { port } = fakeRuntime({
      updateOwnAccount: () => Promise.resolve({ success: false, error: 'Current password is incorrect' }),
    })
    const result = await updateOwnRuntimeAccount(store, asRuntime(port), 7, { password: 'x', currentPassword: 'y' })
    expect(result.success).toBe(false)
    expect(store.getState().runtimeConnection.storedCredentials).toEqual({ username: 'op', password: 'old-pass' })
  })
})
