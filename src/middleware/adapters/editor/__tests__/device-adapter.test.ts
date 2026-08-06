import type { DevicePort } from '../../../shared/ports/device-port'
import type { BoardInfo, CommunicationPort } from '../../../shared/ports/types'
import { createEditorDeviceAdapter } from '../device-adapter'

const mockBoards = new Map<string, BoardInfo>([
  [
    'Arduino Uno',
    {
      compiler: 'arduino-cli',
      core: 'arduino:avr',
      preview: 'uno.png',
      specs: { CPU: 'ATmega328P', RAM: '2 KB' },
      pins: { defaultDin: ['2', '3'], defaultDout: ['4', '5'] },
    },
  ],
])

const mockPorts: CommunicationPort[] = [{ address: '/dev/ttyUSB0' }, { address: '/dev/ttyACM0' }]

const mockRefreshResult = [{ board: 'Arduino Uno', version: '1.8.6' }]

beforeEach(() => {
  window.bridge = {
    getAvailableBoards: jest.fn().mockResolvedValue(mockBoards),
    getAvailableCommunicationPorts: jest.fn().mockResolvedValue(mockPorts),
    refreshAvailableBoards: jest.fn().mockResolvedValue(mockRefreshResult),
    refreshCommunicationPorts: jest.fn().mockResolvedValue(mockPorts),
    getPreviewImage: jest.fn().mockResolvedValue('data:image/png;base64,abc123'),
    deviceConnect: jest.fn().mockResolvedValue({ status: 'connected-with-firmware' }),
    deviceDisconnect: jest.fn().mockResolvedValue({ success: true }),
    onDeviceConnectionStatus: jest.fn().mockReturnValue(() => undefined),
    openRuntimeSession: jest.fn().mockResolvedValue({ success: true }),
    closeRuntimeSession: jest.fn().mockResolvedValue({ success: true }),
    deviceReleaseSerialPort: jest.fn().mockResolvedValue({ released: true }),
    onDeviceLinkLog: jest.fn().mockReturnValue(() => undefined),
    onDevicePlcState: jest.fn().mockReturnValue(() => undefined),
  } as unknown as typeof window.bridge
})

describe('createEditorDeviceAdapter', () => {
  let adapter: DevicePort

  beforeEach(() => {
    adapter = createEditorDeviceAdapter()
  })

  it('delegates getAvailableBoards to window.bridge', async () => {
    const result = await adapter.getAvailableBoards()
    expect(window.bridge.getAvailableBoards).toHaveBeenCalledTimes(1)
    expect(result).toBe(mockBoards)
  })

  it('delegates getCommunicationPorts to window.bridge', async () => {
    const result = await adapter.getCommunicationPorts()
    expect(window.bridge.getAvailableCommunicationPorts).toHaveBeenCalledTimes(1)
    expect(result).toBe(mockPorts)
  })

  it('delegates refreshBoards to window.bridge', async () => {
    const result = await adapter.refreshBoards()
    expect(window.bridge.refreshAvailableBoards).toHaveBeenCalledTimes(1)
    expect(result).toBe(mockRefreshResult)
  })

  it('delegates refreshCommunicationPorts to window.bridge', async () => {
    const result = await adapter.refreshCommunicationPorts()
    expect(window.bridge.refreshCommunicationPorts).toHaveBeenCalledTimes(1)
    expect(result).toBe(mockPorts)
  })

  it('delegates getPreviewImage to window.bridge with image name', async () => {
    const result = await adapter.getPreviewImage('uno.png')
    expect(window.bridge.getPreviewImage).toHaveBeenCalledWith('uno.png', undefined)
    expect(result).toBe('data:image/png;base64,abc123')
  })

  it('forwards vppPackagePath to window.bridge for VPP-shipped previews', async () => {
    await adapter.getPreviewImage('motor-shield.png', '/path/to/pkg')
    expect(window.bridge.getPreviewImage).toHaveBeenCalledWith('motor-shield.png', '/path/to/pkg')
  })

  it('delegates connect to window.bridge with the candidate list', async () => {
    // Connect passes every way to reach the device, in order; the main process
    // tries them and keeps the first that answers.
    const candidates = [
      { connectionType: 'tcp' as const, connectionParams: { ipAddress: '192.168.0.50' } },
      { connectionType: 'rtu' as const, connectionParams: { port: 'COM5', baudRate: 115200 } },
    ]
    const result = await adapter.connect(candidates)
    expect(window.bridge.deviceConnect).toHaveBeenCalledWith(candidates)
    expect(result).toMatchObject({ status: 'connected-with-firmware' })
  })

  it('delegates disconnect to window.bridge', async () => {
    const result = await adapter.disconnect()
    expect(window.bridge.deviceDisconnect).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: true })
  })

  it('delegates onConnectionStatus subscription to window.bridge and returns its unsubscribe', () => {
    const cb = jest.fn()
    const unsub = adapter.onConnectionStatus(cb)
    expect(window.bridge.onDeviceConnectionStatus).toHaveBeenCalledWith(cb)
    expect(typeof unsub).toBe('function')
  })

  /**
   * The session and handoff members. All pure IPC delegation, but each one is a
   * name pairing between the port and the preload bridge — the kind of mismatch
   * that type-checks on neither side once `window.bridge` is cast, and then fails
   * only at runtime as "not a function" in the middle of a connect.
   */
  it('delegates openRuntimeSession with the address and debug channel', async () => {
    const params = {
      address: '192.168.0.9',
      debug: { connectionType: 'websocket' as const, connectionParams: { ipAddress: '192.168.0.9' } },
    }
    const result = await adapter.openRuntimeSession?.(params)
    expect(window.bridge.openRuntimeSession).toHaveBeenCalledWith(params)
    expect(result).toMatchObject({ success: true })
  })

  it('delegates closeRuntimeSession', async () => {
    const result = await adapter.closeRuntimeSession?.()
    expect(window.bridge.closeRuntimeSession).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ success: true })
  })

  it('unwraps releaseSerialPort to the bare `released` flag', async () => {
    // The caller decides whether to reconnect after an upload from this boolean,
    // so the unwrapping is the part worth pinning — not the passthrough.
    await expect(adapter.releaseSerialPort('COM5')).resolves.toBe(true)
    expect(window.bridge.deviceReleaseSerialPort).toHaveBeenCalledWith('COM5')
  })

  it('reports releaseSerialPort false when nothing was held on that port', async () => {
    ;(window.bridge.deviceReleaseSerialPort as jest.Mock).mockResolvedValue({ released: false })
    await expect(adapter.releaseSerialPort(null)).resolves.toBe(false)
  })

  it('delegates onLinkLog subscription and returns its unsubscribe', () => {
    const cb = jest.fn()
    const unsub = adapter.onLinkLog?.(cb)
    expect(window.bridge.onDeviceLinkLog).toHaveBeenCalledWith(cb)
    expect(typeof unsub).toBe('function')
  })

  it('delegates onPlcState subscription and returns its unsubscribe', () => {
    const cb = jest.fn()
    const unsub = adapter.onPlcState?.(cb)
    expect(window.bridge.onDevicePlcState).toHaveBeenCalledWith(cb)
    expect(typeof unsub).toBe('function')
  })
})
