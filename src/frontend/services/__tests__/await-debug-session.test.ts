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
  it('resolves true at once when the session is already up', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connected', '/dev/ttyUSB0')

    await expect(awaitDebugSession(store, 'device')).resolves.toBe(true)
  })

  it('resolves true when the connected push lands after the connect reply', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connecting', null)
    const ready = awaitDebugSession(store, 'device')

    store.getState().deviceActions.setDeviceConnectionStatus('connected', '/dev/ttyUSB0')

    await expect(ready).resolves.toBe(true)
  })

  it('resolves false when the link drops instead', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connecting', null)
    const ready = awaitDebugSession(store, 'device')

    store.getState().deviceActions.setDeviceConnectionStatus('error', null)

    await expect(ready).resolves.toBe(false)
  })

  it('resolves false when the session never arrives', async () => {
    store.getState().deviceActions.setDeviceConnectionStatus('connecting', null)
    const ready = awaitDebugSession(store, 'device', 1000)

    jest.advanceTimersByTime(1000)

    await expect(ready).resolves.toBe(false)
  })
})

describe('awaitDebugSession — runtime', () => {
  beforeEach(() => {
    store.getState().deviceActions.setRuntimeConnectionStatus('connecting')
  })

  it('waits through the login modal and resolves true once the session opens', async () => {
    const ready = awaitDebugSession(store, 'runtime', 1000)
    let settled = false
    void ready.then(() => (settled = true))

    // The login modal has no deadline.
    jest.advanceTimersByTime(60000)
    await Promise.resolve()
    expect(settled).toBe(false)

    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    store.getState().deviceActions.setDeviceConnectionStatus('connected', null)

    await expect(ready).resolves.toBe(true)
  })

  it('resolves false when the login is cancelled', async () => {
    const ready = awaitDebugSession(store, 'runtime')

    store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')

    await expect(ready).resolves.toBe(false)
  })

  it('resolves false when the runtime cannot be reached', async () => {
    const ready = awaitDebugSession(store, 'runtime')

    store.getState().deviceActions.setRuntimeConnectionStatus('error')

    await expect(ready).resolves.toBe(false)
  })

  it('resolves false when the session does not open after the login', async () => {
    const ready = awaitDebugSession(store, 'runtime', 1000)

    store.getState().deviceActions.setRuntimeConnectionStatus('connected')
    jest.advanceTimersByTime(1000)

    await expect(ready).resolves.toBe(false)
  })
})
