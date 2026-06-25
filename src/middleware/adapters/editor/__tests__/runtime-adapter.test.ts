import type { RuntimePort } from '../../../shared/ports/runtime-port'
import { createEditorRuntimeAdapter } from '../runtime-adapter'

let adapter: RuntimePort
let mockIpAddress: string

beforeEach(() => {
  mockIpAddress = '192.168.1.100'

  window.bridge = {
    runtimeLogin: jest.fn().mockResolvedValue({ success: true, accessToken: 'jwt-token-123' }),
    runtimeCreateUser: jest.fn().mockResolvedValue({ success: true }),
    runtimeGetUsersInfo: jest.fn().mockResolvedValue({ hasUsers: true, runtimeVersion: '4.0.0' }),
    runtimeGetStatus: jest.fn().mockResolvedValue({ success: true, status: 'RUNNING' }),
    runtimeStartPlc: jest.fn().mockResolvedValue({ success: true }),
    runtimeStopPlc: jest.fn().mockResolvedValue({ success: true }),
    runtimeGetLogs: jest.fn().mockResolvedValue({ success: true, logs: [] }),
    runtimeGetSerialPorts: jest.fn().mockResolvedValue({ success: true, ports: [] }),
    runtimeGetCompilationStatus: jest.fn().mockResolvedValue({
      success: true,
      data: { status: 'SUCCESS', logs: [], exit_code: 0 },
    }),
    runtimeClearCredentials: jest.fn().mockResolvedValue({ success: true }),
    onRuntimeTokenRefreshed: jest.fn().mockImplementation(() => jest.fn()),
    runtimeDiscoverDevices: jest.fn().mockResolvedValue({ success: true, devices: [] }),
    onRuntimeDeviceDiscovered: jest.fn().mockImplementation(() => jest.fn()),
    etherCATGetInterfaces: jest.fn().mockResolvedValue({ success: true, data: [] }),
    etherCATGetStatus: jest.fn().mockResolvedValue({ success: true, data: {} }),
    etherCATScan: jest.fn().mockResolvedValue({ success: true, data: {} }),
    etherCATTest: jest.fn().mockResolvedValue({ success: true, data: {} }),
    etherCATValidate: jest.fn().mockResolvedValue({ success: true, data: {} }),
    etherCATGetRuntimeStatus: jest.fn().mockResolvedValue({ success: true, data: {} }),
  } as unknown as typeof window.bridge

  adapter = createEditorRuntimeAdapter(() => mockIpAddress)
})

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

describe('login', () => {
  it('delegates to bridge with IP and credentials', async () => {
    const result = await adapter.login({ username: 'admin', password: 'secret' })

    expect(window.bridge.runtimeLogin).toHaveBeenCalledWith('192.168.1.100', 'admin', 'secret')
    expect(result).toEqual({ success: true, accessToken: 'jwt-token-123' })
  })

  it('marks the session active on success (token lives in main)', async () => {
    await adapter.login({ username: 'admin', password: 'secret' })
    // The renderer no longer passes a token; main owns it. Login flips the
    // session-active flag the debugger readiness check relies on.
    expect(adapter.isReadyForDebug!()).toBe(true)
    await adapter.getStatus()
    expect(window.bridge.runtimeGetStatus).toHaveBeenCalledWith('192.168.1.100', undefined)
  })

  it('does not mark the session active on failure', async () => {
    ;(window.bridge.runtimeLogin as jest.Mock).mockResolvedValue({ success: false, error: 'Bad password' })
    await adapter.login({ username: 'admin', password: 'wrong' })
    expect(adapter.isReadyForDebug!()).toBe(false)
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.login({ username: 'admin', password: 'secret' })

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
    expect(window.bridge.runtimeLogin).not.toHaveBeenCalled()
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeLogin as jest.Mock).mockRejectedValue(new Error('IPC failed'))
    const result = await adapter.login({ username: 'admin', password: 'secret' })

    expect(result).toEqual({ success: false, error: 'IPC failed' })
  })
})

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------

describe('createUser', () => {
  it('delegates to bridge with IP and credentials', async () => {
    const result = await adapter.createUser({ username: 'newuser', password: 'pass123' })

    expect(window.bridge.runtimeCreateUser).toHaveBeenCalledWith('192.168.1.100', 'newuser', 'pass123')
    expect(result).toEqual({ success: true })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.createUser({ username: 'newuser', password: 'pass123' })

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeCreateUser as jest.Mock).mockRejectedValue(new Error('Connection refused'))
    const result = await adapter.createUser({ username: 'newuser', password: 'pass123' })

    expect(result).toEqual({ success: false, error: 'Connection refused' })
  })
})

// ---------------------------------------------------------------------------
// getUsersInfo
// ---------------------------------------------------------------------------

describe('getUsersInfo', () => {
  it('delegates to bridge with IP', async () => {
    const result = await adapter.getUsersInfo()

    expect(window.bridge.runtimeGetUsersInfo).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ hasUsers: true, runtimeVersion: '4.0.0' })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.getUsersInfo()

    expect(result).toEqual({ hasUsers: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeGetUsersInfo as jest.Mock).mockRejectedValue(new Error('Timeout'))
    const result = await adapter.getUsersInfo()

    expect(result).toEqual({ hasUsers: false, error: 'Timeout' })
  })
})

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------

describe('getStatus', () => {
  it('delegates to bridge with IP, token, and includeStats', async () => {
    await adapter.login({ username: 'admin', password: 'secret' })
    const result = await adapter.getStatus(true)

    expect(window.bridge.runtimeGetStatus).toHaveBeenCalledWith('192.168.1.100', true)
    expect(result).toEqual({ success: true, status: 'RUNNING' })
  })

  it('passes undefined for includeStats when omitted', async () => {
    await adapter.getStatus()

    expect(window.bridge.runtimeGetStatus).toHaveBeenCalledWith('192.168.1.100', undefined)
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.getStatus()

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeGetStatus as jest.Mock).mockRejectedValue(new Error('Network error'))
    const result = await adapter.getStatus()

    expect(result).toEqual({ success: false, error: 'Network error' })
  })
})

// ---------------------------------------------------------------------------
// startPlc
// ---------------------------------------------------------------------------

describe('startPlc', () => {
  it('delegates to bridge with IP and token', async () => {
    await adapter.login({ username: 'admin', password: 'secret' })
    const result = await adapter.startPlc()

    expect(window.bridge.runtimeStartPlc).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ success: true })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.startPlc()

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeStartPlc as jest.Mock).mockRejectedValue(new Error('PLC busy'))
    const result = await adapter.startPlc()

    expect(result).toEqual({ success: false, error: 'PLC busy' })
  })
})

// ---------------------------------------------------------------------------
// stopPlc
// ---------------------------------------------------------------------------

describe('stopPlc', () => {
  it('delegates to bridge with IP and token', async () => {
    await adapter.login({ username: 'admin', password: 'secret' })
    const result = await adapter.stopPlc()

    expect(window.bridge.runtimeStopPlc).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ success: true })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.stopPlc()

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeStopPlc as jest.Mock).mockRejectedValue(new Error('PLC error'))
    const result = await adapter.stopPlc()

    expect(result).toEqual({ success: false, error: 'PLC error' })
  })
})

// ---------------------------------------------------------------------------
// getLogs
// ---------------------------------------------------------------------------

describe('getLogs', () => {
  it('delegates to bridge with IP, token, and minId', async () => {
    await adapter.login({ username: 'admin', password: 'secret' })
    const result = await adapter.getLogs(42)

    expect(window.bridge.runtimeGetLogs).toHaveBeenCalledWith('192.168.1.100', 42)
    expect(result).toEqual({ success: true, logs: [] })
  })

  it('passes undefined minId when omitted', async () => {
    await adapter.getLogs()

    expect(window.bridge.runtimeGetLogs).toHaveBeenCalledWith('192.168.1.100', undefined)
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.getLogs()

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeGetLogs as jest.Mock).mockRejectedValue(new Error('Log fetch failed'))
    const result = await adapter.getLogs()

    expect(result).toEqual({ success: false, error: 'Log fetch failed' })
  })
})

// ---------------------------------------------------------------------------
// getSerialPorts
// ---------------------------------------------------------------------------

describe('getSerialPorts', () => {
  it('delegates to bridge with IP and token', async () => {
    const ports = [{ device: '/dev/ttyUSB0', description: 'USB Serial' }]
    ;(window.bridge.runtimeGetSerialPorts as jest.Mock).mockResolvedValue({ success: true, ports })

    await adapter.login({ username: 'admin', password: 'secret' })
    const result = await adapter.getSerialPorts()

    expect(window.bridge.runtimeGetSerialPorts).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ success: true, ports })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.getSerialPorts()

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeGetSerialPorts as jest.Mock).mockRejectedValue(new Error('Port scan failed'))
    const result = await adapter.getSerialPorts()

    expect(result).toEqual({ success: false, error: 'Port scan failed' })
  })
})

// ---------------------------------------------------------------------------
// getCompilationStatus
// ---------------------------------------------------------------------------

describe('getCompilationStatus', () => {
  it('delegates to bridge with IP and token', async () => {
    await adapter.login({ username: 'admin', password: 'secret' })
    const result = await adapter.getCompilationStatus()

    expect(window.bridge.runtimeGetCompilationStatus).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ success: true, data: { status: 'SUCCESS', logs: [], exit_code: 0 } })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.getCompilationStatus()

    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeGetCompilationStatus as jest.Mock).mockRejectedValue(new Error('Status check failed'))
    const result = await adapter.getCompilationStatus()

    expect(result).toEqual({ success: false, error: 'Status check failed' })
  })
})

// ---------------------------------------------------------------------------
// clearCredentials
// ---------------------------------------------------------------------------

describe('clearCredentials', () => {
  it('clears internal JWT and delegates to bridge', async () => {
    await adapter.login({ username: 'admin', password: 'secret' })
    const result = await adapter.clearCredentials()

    expect(window.bridge.runtimeClearCredentials).toHaveBeenCalled()
    expect(result).toEqual({ success: true })

    // Subsequent calls should use empty token
    await adapter.getStatus()
    expect(window.bridge.runtimeGetStatus).toHaveBeenCalledWith('192.168.1.100', undefined)
  })
})

// ---------------------------------------------------------------------------
// onTokenRefreshed
// ---------------------------------------------------------------------------

describe('onTokenRefreshed', () => {
  it('subscribes to bridge token refresh events', () => {
    const callback = jest.fn()
    const unsubscribe = jest.fn()
    ;(window.bridge.onRuntimeTokenRefreshed as jest.Mock).mockReturnValue(unsubscribe)

    const unsub = adapter.onTokenRefreshed!(callback)

    expect(window.bridge.onRuntimeTokenRefreshed).toHaveBeenCalledWith(expect.any(Function))
    expect(unsub).toBe(unsubscribe)
  })

  it('forwards the refreshed token from main to the callback', () => {
    // The token lives in the main process now; the adapter only relays the
    // refresh notification so the renderer store flag can track it.
    let bridgeHandler: ((_event: unknown, newToken: string) => void) | null = null
    ;(window.bridge.onRuntimeTokenRefreshed as jest.Mock).mockImplementation(
      (handler: (_event: unknown, newToken: string) => void) => {
        bridgeHandler = handler
        return jest.fn()
      },
    )

    const callback = jest.fn()
    adapter.onTokenRefreshed!(callback)

    bridgeHandler!({}, 'new-token-456')

    expect(callback).toHaveBeenCalledWith('new-token-456')
  })
})

// ---------------------------------------------------------------------------
// IP address getter reactivity
// ---------------------------------------------------------------------------

describe('IP address getter', () => {
  it('reads IP address dynamically on each call', async () => {
    mockIpAddress = '10.0.0.1'
    await adapter.getUsersInfo()
    expect(window.bridge.runtimeGetUsersInfo).toHaveBeenCalledWith('10.0.0.1')

    mockIpAddress = '10.0.0.2'
    await adapter.getUsersInfo()
    expect(window.bridge.runtimeGetUsersInfo).toHaveBeenCalledWith('10.0.0.2')
  })
})

// ---------------------------------------------------------------------------
// isReadyForDebug
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// discoverDevices / onDeviceDiscovered
// ---------------------------------------------------------------------------

describe('discoverDevices', () => {
  it('delegates to bridge with options', async () => {
    const devices = [{ ipAddress: '192.168.1.50', hostname: 'plc-1', runtimeVersion: 'v4.1.0', apiPort: 8443 }]
    ;(window.bridge.runtimeDiscoverDevices as jest.Mock).mockResolvedValue({ success: true, devices })

    const result = await adapter.discoverDevices!({ durationMs: 2000 })

    expect(window.bridge.runtimeDiscoverDevices).toHaveBeenCalledWith({ durationMs: 2000 })
    expect(result).toEqual({ success: true, devices })
  })

  it('works without options', async () => {
    await adapter.discoverDevices!()
    expect(window.bridge.runtimeDiscoverDevices).toHaveBeenCalledWith(undefined)
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeDiscoverDevices as jest.Mock).mockRejectedValue(new Error('UDP bind failed'))
    const result = await adapter.discoverDevices!()
    expect(result).toEqual({ success: false, error: 'UDP bind failed' })
  })
})

describe('onDeviceDiscovered', () => {
  it('subscribes to bridge events and forwards device payload', () => {
    let bridgeHandler: ((_event: unknown, device: unknown) => void) | null = null
    const unsubscribe = jest.fn()
    ;(window.bridge.onRuntimeDeviceDiscovered as jest.Mock).mockImplementation(
      (handler: (_event: unknown, device: unknown) => void) => {
        bridgeHandler = handler
        return unsubscribe
      },
    )

    const callback = jest.fn()
    const unsub = adapter.onDeviceDiscovered!(callback)

    const device = { ipAddress: '10.0.0.5', hostname: 'rpi-3', runtimeVersion: 'v4.1.0', apiPort: 8443 }
    bridgeHandler!({}, device)

    expect(callback).toHaveBeenCalledWith(device)
    expect(unsub).toBe(unsubscribe)
  })
})

// ---------------------------------------------------------------------------
// EtherCAT discovery methods — thin bridge delegators (no token; main owns it)
// ---------------------------------------------------------------------------

describe('EtherCAT discovery methods', () => {
  const cases: Array<{
    name: string
    bridge: keyof typeof window.bridge
    invoke: (a: RuntimePort) => Promise<unknown>
    expectArgs: unknown[]
  }> = [
    {
      name: 'getNetworkInterfaces',
      bridge: 'etherCATGetInterfaces',
      invoke: (a) => a.getNetworkInterfaces!(),
      expectArgs: ['192.168.1.100'],
    },
    {
      name: 'getEthercatServiceStatus',
      bridge: 'etherCATGetStatus',
      invoke: (a) => a.getEthercatServiceStatus!(),
      expectArgs: ['192.168.1.100'],
    },
    {
      name: 'scanEthercatDevices',
      bridge: 'etherCATScan',
      invoke: (a) => a.scanEthercatDevices!({ interface: 'eth0' } as never),
      expectArgs: ['192.168.1.100', { interface: 'eth0' }],
    },
    {
      name: 'testEthercatConnection',
      bridge: 'etherCATTest',
      invoke: (a) => a.testEthercatConnection!({ slave: 1 } as never),
      expectArgs: ['192.168.1.100', { slave: 1 }],
    },
    {
      name: 'validateEthercatConfig',
      bridge: 'etherCATValidate',
      invoke: (a) => a.validateEthercatConfig!({ config: {} } as never),
      expectArgs: ['192.168.1.100', { config: {} }],
    },
    {
      name: 'getEthercatRuntimeStatus',
      bridge: 'etherCATGetRuntimeStatus',
      invoke: (a) => a.getEthercatRuntimeStatus!(),
      expectArgs: ['192.168.1.100'],
    },
  ]

  it.each(cases)('$name delegates to the bridge without a token', async ({ bridge, invoke, expectArgs }) => {
    await invoke(adapter)
    expect(window.bridge[bridge]).toHaveBeenCalledWith(...expectArgs)
  })

  it.each(cases)('$name surfaces a bridge error', async ({ bridge, invoke }) => {
    ;(window.bridge[bridge] as jest.Mock).mockRejectedValueOnce(new Error('boom'))
    const result = (await invoke(adapter)) as { success: boolean; error?: string }
    expect(result).toEqual({ success: false, error: 'boom' })
  })
})

describe('isReadyForDebug', () => {
  it('returns false when no IP and no token', () => {
    mockIpAddress = ''
    expect(adapter.isReadyForDebug!()).toBe(false)
  })

  it('returns false when IP is set but no JWT token', () => {
    mockIpAddress = '192.168.1.100'
    expect(adapter.isReadyForDebug!()).toBe(false)
  })

  it('returns true when both IP and JWT token are set', async () => {
    mockIpAddress = '192.168.1.100'
    await adapter.login({ username: 'admin', password: 'secret' })

    expect(adapter.isReadyForDebug!()).toBe(true)
  })

  it('returns false after credentials are cleared', async () => {
    mockIpAddress = '192.168.1.100'
    await adapter.login({ username: 'admin', password: 'secret' })
    await adapter.clearCredentials()

    expect(adapter.isReadyForDebug!()).toBe(false)
  })
})
