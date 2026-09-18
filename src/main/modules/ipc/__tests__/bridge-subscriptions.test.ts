/**
 * Covers the layer the accelerator listener leak actually lived in: the bridge.
 *
 * The adapter tests above this one run against a mocked bridge, so they prove
 * the adapter forwards whatever disposer it is handed — but a mock that defines
 * the contract cannot prove `renderer.ts` honours it. These tests drive the real
 * bridge against a real EventEmitter, so a `subscribe` helper that closed over
 * the wrong function (or went back to `removeAllListeners`) fails here.
 */
import { EventEmitter } from 'events'

const ipc = new EventEmitter()

jest.mock('electron', () => ({
  ipcRenderer: ipc,
  contextBridge: { exposeInMainWorld: jest.fn() },
}))

import rendererProcessBridge from '../renderer'

const EXPORT_CHANNEL = 'compiler:export-project-request'
const SAVE_CHANNEL = 'project:save-file-accelerator'

beforeEach(() => {
  ipc.removeAllListeners()
  jest.restoreAllMocks()
})

describe('subscribe', () => {
  it('removes the exact listener it registered', () => {
    const on = jest.spyOn(ipc, 'on')
    const removeListener = jest.spyOn(ipc, 'removeListener')

    const unsubscribe = rendererProcessBridge.exportProjectRequest(() => {})
    const registered = on.mock.calls[0][1]

    unsubscribe()

    // Same function object on both sides — a wrapper rebuilt on unsubscribe
    // would silently leave the original listener attached.
    expect(removeListener).toHaveBeenCalledWith(EXPORT_CHANNEL, registered)
  })

  it('leaves no listener behind across repeated mount/unmount cycles', () => {
    // Stands in for a React effect re-running on every dependency change, which
    // is what drove the channel past Node's ten-listener warning threshold.
    for (let cycle = 0; cycle < 15; cycle++) {
      const unsubscribe = rendererProcessBridge.exportProjectRequest(() => {})
      unsubscribe()
    }

    expect(ipc.listenerCount(EXPORT_CHANNEL)).toBe(0)
  })

  it('keeps sibling subscribers on the same channel alive', () => {
    // The reason `removeAllListeners` was never an acceptable disposer.
    const first = jest.fn()
    const second = jest.fn()

    const unsubscribeFirst = rendererProcessBridge.saveFileAccelerator(first)
    rendererProcessBridge.saveFileAccelerator(second)

    unsubscribeFirst()
    ipc.emit(SAVE_CHANNEL, {})

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(ipc.listenerCount(SAVE_CHANNEL)).toBe(1)
  })

  it('forwards the event and payload to the callback', () => {
    const callback = jest.fn()
    rendererProcessBridge.openRecentAccelerator(callback)

    const event = {}
    const payload = { projectPath: '/some/path' }
    ipc.emit('project:open-recent-accelerator', event, payload)

    expect(callback).toHaveBeenCalledWith(event, payload)
  })
})
