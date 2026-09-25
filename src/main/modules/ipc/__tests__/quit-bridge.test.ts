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
  ipc.send.mockClear()
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
})
