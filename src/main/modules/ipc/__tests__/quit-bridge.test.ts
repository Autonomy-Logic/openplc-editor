/**
 * The renderer side of the quit channels, against the real bridge.
 */
import { EventEmitter } from 'events'

const ipc = Object.assign(new EventEmitter(), { send: jest.fn() })

jest.mock('electron', () => ({
  ipcRenderer: ipc,
  contextBridge: { exposeInMainWorld: jest.fn() },
}))

import rendererProcessBridge from '../renderer'

beforeEach(() => {
  ipc.removeAllListeners()
  ipc.send.mockReset()
})

describe('requestQuitApp', () => {
  it('sends app:request-quit', () => {
    rendererProcessBridge.requestQuitApp()

    expect(ipc.send).toHaveBeenCalledWith('app:request-quit')
  })
})

describe('quitRequested', () => {
  it('fires on app:quit-requested', () => {
    const cb = jest.fn()
    rendererProcessBridge.quitRequested(cb)

    ipc.emit('app:quit-requested', {})

    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('stops firing once unsubscribed', () => {
    const cb = jest.fn()
    const unsubscribe = rendererProcessBridge.quitRequested(cb)

    unsubscribe()
    ipc.emit('app:quit-requested', {})

    expect(cb).not.toHaveBeenCalled()
    expect(ipc.listenerCount('app:quit-requested')).toBe(0)
  })

  it('tells main the prompt listener is ready once subscribed', () => {
    rendererProcessBridge.quitRequested(jest.fn())

    expect(ipc.send).toHaveBeenCalledWith('app:quit-ready')
    expect(ipc.listenerCount('app:quit-requested')).toBe(1)
  })

  it('announces ready only after the listener is attached', () => {
    ipc.send.mockImplementation((channel: string) => {
      if (channel === 'app:quit-ready') expect(ipc.listenerCount('app:quit-requested')).toBe(1)
    })

    rendererProcessBridge.quitRequested(jest.fn())

    expect(ipc.send).toHaveBeenCalledWith('app:quit-ready')
  })

  it('tells main the listener is gone once unsubscribed', () => {
    const unsubscribe = rendererProcessBridge.quitRequested(jest.fn())
    ipc.send.mockClear()

    unsubscribe()

    expect(ipc.send).toHaveBeenCalledWith('app:quit-unready')
  })
})
