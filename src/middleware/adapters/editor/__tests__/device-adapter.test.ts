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

const mockPorts: CommunicationPort[] = [
  { name: '/dev/ttyUSB0', address: '/dev/ttyUSB0' },
  { name: '/dev/ttyACM0', address: '/dev/ttyACM0' },
]

const mockRefreshResult = [{ board: 'Arduino Uno', version: '1.8.6' }]

beforeEach(() => {
  window.bridge = {
    getAvailableBoards: jest.fn().mockResolvedValue(mockBoards),
    getAvailableCommunicationPorts: jest.fn().mockResolvedValue(mockPorts),
    refreshAvailableBoards: jest.fn().mockResolvedValue(mockRefreshResult),
    refreshCommunicationPorts: jest.fn().mockResolvedValue(mockPorts),
    getPreviewImage: jest.fn().mockResolvedValue('data:image/png;base64,abc123'),
    activateDeviceLicense: jest
      .fn()
      .mockResolvedValue({ success: true, probedAt: '2026-07-22T00:00:00.000Z', outcome: 'activated' }),
    deviceConnect: jest
      .fn()
      .mockResolvedValue({ status: 'connected-with-firmware', anchorHex: 'deadbeef', licenseStatus: 'licensed' }),
    deviceDisconnect: jest.fn().mockResolvedValue({ success: true }),
    deviceReadBoardId: jest
      .fn()
      .mockResolvedValue({ success: true, anchorHex: '00b18ced', deviceId: '7b3ea3f4c33fe6f1af313a4c4bf94b56' }),
    deviceReadLicense: jest.fn().mockResolvedValue({ success: true, licenseStatus: 'licensed', deviceId: 'abc' }),
    deviceRefreshLicense: jest
      .fn()
      .mockResolvedValue({ status: 'connected-with-firmware', licenseStatus: 'licensed', activation: 'activated' }),
    onDeviceConnectionStatus: jest.fn().mockReturnValue(() => undefined),
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

  it('delegates activateLicense to window.bridge with params and opts', async () => {
    const params = { connectionType: 'rtu' as const, port: 'COM5', baudRate: 115200 }
    const result = await adapter.activateLicense(params, { packageId: 'com.vendor.board', keyId: 'k1' })
    expect(window.bridge.activateDeviceLicense).toHaveBeenCalledWith(params, {
      packageId: 'com.vendor.board',
      keyId: 'k1',
    })
    expect(result).toEqual({ success: true, probedAt: '2026-07-22T00:00:00.000Z', outcome: 'activated' })
  })

  it('delegates connect to window.bridge with params and opts', async () => {
    const params = { connectionType: 'rtu' as const, port: 'COM5', baudRate: 115200 }
    const result = await adapter.connect(params, { isLicensable: true, packageId: 'com.vendor.board', keyId: 'k1' })
    expect(window.bridge.deviceConnect).toHaveBeenCalledWith(params, {
      isLicensable: true,
      packageId: 'com.vendor.board',
      keyId: 'k1',
    })
    expect(result).toMatchObject({ status: 'connected-with-firmware', licenseStatus: 'licensed' })
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
  // The three on-demand FCs. What they prove here is only the delegation and the
  // argument shape -- the behaviour lives in the main process. The `undefined`
  // pass-through matters: the handlers default the options object themselves, and
  // the adapter must not invent one.
  it('delegates readBoardId to window.bridge, returning both ids', async () => {
    const result = await adapter.readBoardId()
    expect(window.bridge.deviceReadBoardId).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      success: true,
      anchorHex: '00b18ced',
      deviceId: '7b3ea3f4c33fe6f1af313a4c4bf94b56',
    })
  })

  it('delegates readLicense to window.bridge with the packageId', async () => {
    const result = await adapter.readLicense({ packageId: 'com.vendor.board' })
    expect(window.bridge.deviceReadLicense).toHaveBeenCalledWith({ packageId: 'com.vendor.board' })
    expect(result).toMatchObject({ success: true, licenseStatus: 'licensed' })
  })

  it('passes readLicense through with no options at all', async () => {
    await adapter.readLicense()
    expect(window.bridge.deviceReadLicense).toHaveBeenCalledWith(undefined)
  })

  it('delegates refreshLicense to window.bridge with the recover options', async () => {
    const result = await adapter.refreshLicense({ isLicensable: true, packageId: 'com.vendor.board', keyId: 'k1' })
    expect(window.bridge.deviceRefreshLicense).toHaveBeenCalledWith({
      isLicensable: true,
      packageId: 'com.vendor.board',
      keyId: 'k1',
    })
    expect(result).toMatchObject({ activation: 'activated' })
  })

  it('passes refreshLicense through with no options at all', async () => {
    await adapter.refreshLicense()
    expect(window.bridge.deviceRefreshLicense).toHaveBeenCalledWith(undefined)
  })
})
