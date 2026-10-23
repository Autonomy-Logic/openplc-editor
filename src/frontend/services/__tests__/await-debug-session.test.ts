import type { OpenPLCStore } from '../../store'
import { createTestStore } from '../../store/testing'
import { awaitDebugSession } from '../await-debug-session'

let store: OpenPLCStore

beforeEach(() => {
  jest.useFakeTimers()
  store = createTestStore()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('awaitDebugSession — device', () => {
  it('settles connected at once when the session is already up', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connected', '/dev/ttyUSB0')

    await expect(awaitDebugSession(store, 'device')).resolves.toBe('connected')
  })

  it('settles connected when the connected push lands after the connect reply', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connecting', null)
    const ready = awaitDebugSession(store, 'device')

    store.getState().deviceActions.setDeviceConnectionStatus('connected', '/dev/ttyUSB0')

    await expect(ready).resolves.toBe('connected')
  })

  it('is not woken by unrelated store changes', async () => {
    const { consoleActions, deviceActions } = store.getState()
    deviceActions.setDeviceConnectionStatus('connecting', null)
    const getState = jest.spyOn(store, 'getState')
    const ready = awaitDebugSession(store, 'device')
    const readsAfterStart = getState.mock.calls.length

    consoleActions.addLog({ level: 'info', message: 'unrelated' })
    expect(getState.mock.calls.length).toBe(readsAfterStart)

    deviceActions.setDeviceConnectionStatus('connected', '/dev/ttyUSB0')
    await expect(ready).resolves.toBe('connected')
    getState.mockRestore()
  })

  it('fails when the link drops instead', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connecting', null)
    const ready = awaitDebugSession(store, 'device')

    store.getState().deviceActions.setDeviceConnectionStatus('error', null)

    await expect(ready).resolves.toBe('failed')
  })

  it('times out when the session never arrives', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connecting', null)
    const ready = awaitDebugSession(store, 'device', 1000)

    jest.advanceTimersByTime(1000)

    await expect(ready).resolves.toBe('timeout')
  })
})

describe('awaitDebugSession — runtime', () => {
  beforeEach(() => {
    store.getState().deviceActions.setRuntimeConnectionStatus('connecting')
  })

  it('waits through the login modal and settles connected once the session opens', async () => {
    const ready = awaitDebugSession(store, 'runtime', 1000)
    let settled = false
    void ready.then(() => (settled = true))

    // The login modal has no deadline.
    jest.advanceTimersByTime(60000)
    await Promise.resolve()
    expect(settled).toBe(false)

    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    store.getState().deviceActions.setDeviceConnectionStatus('connected', null)

    await expect(ready).resolves.toBe('connected')
  })

  it('reports a cancelled login', async () => {
    const ready = awaitDebugSession(store, 'runtime')

    store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')

    await expect(ready).resolves.toBe('cancelled')
  })

  it('fails when the runtime cannot be reached', async () => {
    const ready = awaitDebugSession(store, 'runtime')

    store.getState().deviceActions.setRuntimeConnectionStatus('error')

    await expect(ready).resolves.toBe('failed')
  })

  it('times out when the session does not open after the login', async () => {
    const ready = awaitDebugSession(store, 'runtime', 1000)

    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    jest.advanceTimersByTime(1000)

    await expect(ready).resolves.toBe('timeout')
  })
})
