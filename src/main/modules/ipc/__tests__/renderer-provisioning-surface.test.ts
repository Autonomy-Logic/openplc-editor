import { EventEmitter } from 'events'

import type { RuntimeProvisioningPort } from '../../../../middleware/shared/ports/runtime-provisioning-port'

const mockInvoke = jest.fn<Promise<unknown>, unknown[]>()
const mockIpc = Object.assign(new EventEmitter(), {
  invoke: (...args: unknown[]) => mockInvoke(...args),
  send: jest.fn(),
})

jest.mock('electron', () => ({
  ipcRenderer: mockIpc,
  contextBridge: { exposeInMainWorld: jest.fn() },
}))

import rendererProcessBridge from '../renderer'

const PROVISIONING_MEMBERS = [
  'onRuntimeProvisioningEvent',
  'runtimeProvisioningCancel',
  'runtimeProvisioningProbeSsh',
  'runtimeProvisioningRun',
]
const EVENT_CHANNEL = 'runtime-provisioning:event'

beforeEach(() => {
  mockIpc.removeAllListeners()
  mockInvoke.mockReset()
  mockInvoke.mockResolvedValue({ answered: true })
})

describe('the provisioning surface of the renderer bridge (AS-17, M10)', () => {
  it('exposes exactly probe, run, cancel and progress for provisioning', () => {
    const names = Object.keys(rendererProcessBridge).filter((name) => /provisioning/i.test(name))

    expect(names.sort()).toEqual(PROVISIONING_MEMBERS)
  })

  it('takes one request for probe and run, nothing for cancel, and one callback for progress', () => {
    expect(rendererProcessBridge.runtimeProvisioningProbeSsh).toHaveLength(1)
    expect(rendererProcessBridge.runtimeProvisioningRun).toHaveLength(1)
    expect(rendererProcessBridge.runtimeProvisioningCancel).toHaveLength(0)
    expect(rendererProcessBridge.onRuntimeProvisioningEvent).toHaveLength(1)
  })

  it('keeps the port to probe, run, cancel and progress', () => {
    const members: Record<keyof RuntimeProvisioningPort, true> = {
      probeSsh: true,
      run: true,
      cancel: true,
      onEvent: true,
    }

    expect(Object.keys(members).sort()).toEqual(['cancel', 'onEvent', 'probeSsh', 'run'])
  })
})

describe('the provisioning bridge members', () => {
  it('invokes runtime-provisioning:probe-ssh with the request unchanged and returns the answer', async () => {
    const request = { host: '192.168.1.50', port: 22 }

    await expect(rendererProcessBridge.runtimeProvisioningProbeSsh(request)).resolves.toEqual({ answered: true })
    expect(mockInvoke.mock.calls).toEqual([['runtime-provisioning:probe-ssh', request]])
    expect(mockInvoke.mock.calls[0]?.[1]).toBe(request)
  })

  it('invokes runtime-provisioning:run with the request unchanged and returns the outcome', async () => {
    const request = { host: '192.168.1.50', port: 22, username: 'commissioner42', password: 'S3cr3t-Pi!' }
    mockInvoke.mockResolvedValue({ kind: 'busy' })

    await expect(rendererProcessBridge.runtimeProvisioningRun(request)).resolves.toEqual({ kind: 'busy' })
    expect(mockInvoke.mock.calls).toEqual([['runtime-provisioning:run', request]])
    expect(mockInvoke.mock.calls[0]?.[1]).toBe(request)
  })

  it('invokes runtime-provisioning:cancel with no argument', async () => {
    mockInvoke.mockResolvedValue(undefined)

    await expect(rendererProcessBridge.runtimeProvisioningCancel()).resolves.toBeUndefined()
    expect(mockInvoke.mock.calls).toEqual([['runtime-provisioning:cancel']])
  })

  it('hands each progress event to the callback without the IPC event object', () => {
    const received: unknown[][] = []
    rendererProcessBridge.onRuntimeProvisioningEvent((...args: unknown[]) => {
      received.push(args)
    })
    const event = { type: 'phase', phase: 'connecting', cancellable: true }

    mockIpc.emit(EVENT_CHANNEL, { sender: 'ipc' }, event)

    expect(received).toEqual([[event]])
  })

  it('stops calling the callback once unsubscribed, keeping other subscribers', () => {
    const removed = jest.fn()
    const kept = jest.fn()
    const unsubscribe = rendererProcessBridge.onRuntimeProvisioningEvent(removed)
    rendererProcessBridge.onRuntimeProvisioningEvent(kept)

    unsubscribe()
    mockIpc.emit(EVENT_CHANNEL, {}, { type: 'output', line: 'Done' })

    expect(removed).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledTimes(1)
    expect(mockIpc.listenerCount(EVENT_CHANNEL)).toBe(1)
  })
})
