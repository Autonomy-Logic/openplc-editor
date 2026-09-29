import { WEB_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import type { PlatformPorts } from '@root/middleware/shared/providers/types'
import { renderHook } from '@testing-library/react'

jest.mock('../../services/device-link-resolution', () => ({
  resolveRuntimeDebugChannel: (...args: unknown[]) => mockResolveRuntimeDebugChannel(...(args as [])),
}))

import type { DevicePort } from '@root/middleware/shared/ports/device-port'
import type { OpenPLCStore } from '../../store'
import { createStoreWrapper, createTestStore } from '../../store/testing'
import { useDeviceConnectionMonitor } from '../use-device-connection-monitor'

const mockOpenRuntimeSession = jest.fn().mockResolvedValue({ success: true })
const mockCloseRuntimeSession = jest.fn().mockResolvedValue({ success: true })
const mockResolveRuntimeDebugChannel = jest.fn(() => null as unknown)

const mockOnConnectionStatus = jest.fn().mockReturnValue(() => undefined)
const mockOnLinkLog = jest.fn().mockReturnValue(() => undefined)

function stubPort<T extends object>(overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return typeof prop === 'string' ? () => undefined : undefined
    },
  })
}

function buildPorts(): PlatformPorts {
  return {
    compiler: stubPort(),
    runtime: stubPort(),
    debugger: stubPort(),
    simulator: stubPort(),
    project: stubPort(),
    device: stubPort<DevicePort>({
      onConnectionStatus: mockOnConnectionStatus,
      onLinkLog: mockOnLinkLog,
      openRuntimeSession: mockOpenRuntimeSession,
      closeRuntimeSession: mockCloseRuntimeSession,
    }),
    orchestrator: stubPort(),
    system: stubPort(),
    window: stubPort(),
    accelerator: stubPort(),
    theme: stubPort(),
    versionControl: stubPort(),
    navigation: stubPort(),
    library: stubPort(),
    capabilities: WEB_CAPABILITIES,
  }
}

const RUNTIME_BOARD: BoardInfo = { compiler: 'runtime_v4', core: 'openplc', preview: 'generic.png', specs: {} }

let store: OpenPLCStore
let ports: PlatformPorts

/** Immer freezes the action namespaces, so spies go in as a swapped, write-through copy. */
function installActionSpies() {
  const { modalActions, consoleActions, deviceActions } = store.getState()
  const spies = {
    openModal: jest.fn(modalActions.openModal),
    addLog: jest.fn(consoleActions.addLog),
    setDeviceConnectionStatus: jest.fn(deviceActions.setDeviceConnectionStatus),
  }
  store.setState({
    modalActions: { ...modalActions, openModal: spies.openModal },
    consoleActions: { ...consoleActions, addLog: spies.addLog },
    deviceActions: { ...deviceActions, setDeviceConnectionStatus: spies.setDeviceConnectionStatus },
  })
  return spies
}

let spies: ReturnType<typeof installActionSpies>

function renderMonitor() {
  return renderHook(() => useDeviceConnectionMonitor(), { wrapper: createStoreWrapper(store, ports) })
}

type Payload = {
  status: string
  descriptor?: string
  transport?: 'rtu' | 'tcp'
  debugTransport?: 'rtu' | 'tcp' | 'websocket'
  reason?: 'lost'
}

/** Mount the hook and hand back the main-process push callback. */
function mountAndPush(): (payload: Payload) => void {
  renderMonitor()
  return mockOnConnectionStatus.mock.calls[0][0] as (payload: Payload) => void
}

beforeEach(() => {
  jest.clearAllMocks()
  store = createTestStore()
  store.getState().deviceActions.setDeviceBoard('OpenPLC Runtime v4')
  ports = buildPorts()
  spies = installActionSpies()
  mockOnConnectionStatus.mockReturnValue(() => undefined)
  mockOnLinkLog.mockReturnValue(() => undefined)
  mockResolveRuntimeDebugChannel.mockReturnValue(null)
})

describe('useDeviceConnectionMonitor', () => {
  describe('runtime sessions', () => {
    it('opens a session when a runtime login comes up', () => {
      // A runtime is controlled over REST, which is connectionless — logging in IS
      // what establishes its session.
      const { deviceActions } = store.getState()
      deviceActions.setRuntimeIpAddress('10.0.0.5')
      deviceActions.setRuntimeJwtToken('jwt')
      deviceActions.setRuntimeConnectionStatus('connected')
      deviceActions.setAvailableOptions({ availableBoards: new Map([['OpenPLC Runtime v4', RUNTIME_BOARD]]) })
      const debugChannel = { connectionType: 'websocket', connectionParams: { ipAddress: '10.0.0.5' } }
      mockResolveRuntimeDebugChannel.mockReturnValue(debugChannel)

      renderMonitor()

      expect(mockOpenRuntimeSession).toHaveBeenCalledWith({ address: '10.0.0.5', debug: debugChannel })
    })

    it('closes the session when the runtime connection goes down', () => {
      renderMonitor()
      expect(mockCloseRuntimeSession).toHaveBeenCalledTimes(1)
      expect(mockOpenRuntimeSession).not.toHaveBeenCalled()
    })
  })

  it('mirrors the main-process connection trace into the console', () => {
    // The decisions worth reading happen in the main process; the console is where
    // a user can actually see and copy them while reproducing a problem.
    renderMonitor()
    const emit = mockOnLinkLog.mock.calls[0][0] as (message: string) => void

    emit('open: 2 candidate(s) in order: tcp 192.168.2.20, rtu /dev/ttyACM0')

    expect(spies.addLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'info', message: expect.stringContaining('tcp 192.168.2.20') }),
    )
  })

  it('subscribes once on mount and unsubscribes on unmount', () => {
    const unsubscribe = jest.fn()
    mockOnConnectionStatus.mockReturnValue(unsubscribe)

    const { unmount } = renderMonitor()
    expect(mockOnConnectionStatus).toHaveBeenCalledTimes(1)

    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('mirrors every pushed status into the store', () => {
    const push = mountAndPush()

    for (const status of ['connecting', 'connected', 'disconnected', 'error'] as const) {
      push({ status, descriptor: 'COM5', transport: 'rtu', debugTransport: 'rtu' })
      expect(spies.setDeviceConnectionStatus).toHaveBeenCalledWith(status, 'COM5', 'rtu', 'rtu')
    }
  })

  it('mirrors a recovery attempt as connecting, with no transport claimed yet', () => {
    const push = mountAndPush()

    push({ status: 'connecting', descriptor: 'COM5' })
    expect(spies.setDeviceConnectionStatus).toHaveBeenCalledWith('connecting', 'COM5', null, null)
  })

  it('warns the user only when recovery gave up', () => {
    const push = mountAndPush()

    // An 'error' from something the user just clicked already has its own dialog.
    push({ status: 'error', descriptor: 'COM5' })
    expect(spies.openModal).not.toHaveBeenCalled()

    push({ status: 'error', descriptor: 'COM5', reason: 'lost' })
    expect(spies.openModal).toHaveBeenCalledTimes(1)
    const [modalId, data] = spies.openModal.mock.calls[0]
    expect(modalId).toBe('runtime-connection-lost')
    expect(data).toMatchObject({ label: 'COM5' })
    expect(String((data as { body: string }).body)).toContain('COM5')
  })

  it('does not warn while the link is merely reconnecting', () => {
    // The whole point of recovery: a cable pulled and plugged back in must not
    // interrupt the user with a dialog.
    const push = mountAndPush()

    push({ status: 'connecting', descriptor: 'COM5' })
    push({ status: 'connected', descriptor: 'COM5' })

    expect(spies.openModal).not.toHaveBeenCalled()
  })

  it('still names the device when the endpoint is unknown', () => {
    const push = mountAndPush()
    push({ status: 'error', reason: 'lost' })
    expect(spies.openModal).toHaveBeenCalledWith('runtime-connection-lost', {
      label: 'the device',
      body: expect.stringContaining('the device'),
    })
  })

  it('advises the right thing to check for the transport that dropped', () => {
    // "Check the cable" is useless advice for a link that ran over ethernet.
    const push = mountAndPush()
    push({ status: 'error', descriptor: '192.168.0.50', transport: 'tcp', reason: 'lost' })

    const [, data] = spies.openModal.mock.calls[0]
    expect((data as { body: string }).body).toContain('192.168.0.50')
    expect((data as { body: string }).body).toContain('network')
    expect((data as { body: string }).body).not.toContain('cable')
  })
})
