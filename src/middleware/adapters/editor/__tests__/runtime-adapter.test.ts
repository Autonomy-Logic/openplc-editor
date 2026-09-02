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
    runtimeListUsers: jest.fn().mockResolvedValue({
      success: true,
      users: [{ id: 1, username: 'admin', role: 'admin' }],
    }),
    runtimeWhoAmI: jest.fn().mockResolvedValue({ success: true, user: { id: 1, username: 'admin', role: 'admin' } }),
    runtimeGetRetainConfig: jest.fn().mockResolvedValue({
      success: true,
      config: {
        enabled: false,
        path: '/var/lib/openplc-runtime/retain.bin',
        flushSeconds: 5,
        defaultPath: '/var/lib/openplc-runtime/retain.bin',
        defaultFlushSeconds: 5,
        minFlushSeconds: 1,
        maxFlushSeconds: 3600,
        backend: 'none',
        backendDetail: '',
        active: false,
      },
    }),
    runtimeUpdateRetainConfig: jest.fn().mockResolvedValue({ success: true, config: { enabled: true } }),
    runtimeUpdateUser: jest.fn().mockResolvedValue({ success: true }),
    runtimeDeleteUser: jest.fn().mockResolvedValue({ success: true }),
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
    runtimeRetrieveProject: jest.fn().mockResolvedValue({
      success: true,
      projectName: 'Traffic Light',
      libraries: [],
    }),
    runtimeInstallRetrievedLibraries: jest
      .fn()
      .mockResolvedValue({ success: true, installed: ['oscat-basic'], failed: [] }),
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
  it('delegates to bridge with IP and credentials (no role forwards undefined)', async () => {
    const result = await adapter.createUser({ username: 'newuser', password: 'pass123' })

    expect(window.bridge.runtimeCreateUser).toHaveBeenCalledWith('192.168.1.100', 'newuser', 'pass123', undefined)
    expect(result).toEqual({ success: true })
  })

  it('forwards the role when provided', async () => {
    await adapter.createUser({ username: 'newuser', password: 'pass123', role: 'admin' })

    expect(window.bridge.runtimeCreateUser).toHaveBeenCalledWith('192.168.1.100', 'newuser', 'pass123', 'admin')
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
// listUsers / whoAmI / updateUser / deleteUser
// ---------------------------------------------------------------------------

describe('listUsers', () => {
  it('delegates to bridge with IP', async () => {
    const result = await adapter.listUsers()
    expect(window.bridge.runtimeListUsers).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ success: true, users: [{ id: 1, username: 'admin', role: 'admin' }] })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.listUsers()
    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeListUsers as jest.Mock).mockRejectedValue(new Error('list failed'))
    const result = await adapter.listUsers()
    expect(result).toEqual({ success: false, error: 'list failed' })
  })
})

describe('getRetainConfig', () => {
  it('delegates to bridge with IP', async () => {
    const result = await adapter.getRetainConfig()
    expect(window.bridge.runtimeGetRetainConfig).toHaveBeenCalledWith('192.168.1.100')
    expect(result.success).toBe(true)
    expect(result.config?.backend).toBe('none')
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.getRetainConfig()
    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeGetRetainConfig as jest.Mock).mockRejectedValue(new Error('read failed'))
    const result = await adapter.getRetainConfig()
    expect(result).toEqual({ success: false, error: 'read failed' })
  })
})

describe('updateRetainConfig', () => {
  it('passes the params through to the bridge', async () => {
    const params = { enabled: true, path: '/data/retain.bin', flushSeconds: 30 }
    const result = await adapter.updateRetainConfig(params)
    expect(window.bridge.runtimeUpdateRetainConfig).toHaveBeenCalledWith('192.168.1.100', params)
    expect(result.success).toBe(true)
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.updateRetainConfig({ enabled: true })
    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeUpdateRetainConfig as jest.Mock).mockRejectedValue(new Error('save failed'))
    const result = await adapter.updateRetainConfig({ enabled: true })
    expect(result).toEqual({ success: false, error: 'save failed' })
  })
})

describe('whoAmI', () => {
  it('delegates to bridge with IP', async () => {
    const result = await adapter.whoAmI()
    expect(window.bridge.runtimeWhoAmI).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ success: true, user: { id: 1, username: 'admin', role: 'admin' } })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.whoAmI()
    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeWhoAmI as jest.Mock).mockRejectedValue(new Error('whoami failed'))
    const result = await adapter.whoAmI()
    expect(result).toEqual({ success: false, error: 'whoami failed' })
  })
})

describe('updateUser', () => {
  it('delegates to bridge with IP, id and params', async () => {
    const params = { username: 'bobby', password: 'np', currentPassword: 'op', role: 'user' as const }
    const result = await adapter.updateUser(7, params)
    expect(window.bridge.runtimeUpdateUser).toHaveBeenCalledWith('192.168.1.100', 7, params)
    expect(result).toEqual({ success: true })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.updateUser(7, { username: 'x' })
    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeUpdateUser as jest.Mock).mockRejectedValue(new Error('update failed'))
    const result = await adapter.updateUser(7, { username: 'x' })
    expect(result).toEqual({ success: false, error: 'update failed' })
  })
})

describe('deleteUser', () => {
  it('delegates to bridge with IP and id', async () => {
    const result = await adapter.deleteUser(9)
    expect(window.bridge.runtimeDeleteUser).toHaveBeenCalledWith('192.168.1.100', 9)
    expect(result).toEqual({ success: true })
  })

  it('returns error when no IP configured', async () => {
    mockIpAddress = ''
    const result = await adapter.deleteUser(9)
    expect(result).toEqual({ success: false, error: 'No runtime IP address configured' })
  })

  it('catches bridge errors', async () => {
    ;(window.bridge.runtimeDeleteUser as jest.Mock).mockRejectedValue(new Error('delete failed'))
    const result = await adapter.deleteUser(9)
    expect(result).toEqual({ success: false, error: 'delete failed' })
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

// ---------------------------------------------------------------------------
// stored source project
// ---------------------------------------------------------------------------

describe('retrieveProject', () => {
  it('delegates to bridge with the device address', async () => {
    const result = await adapter.retrieveProject!('192.168.1.100')

    expect(window.bridge.runtimeRetrieveProject).toHaveBeenCalledWith('192.168.1.100')
    expect(result).toEqual({ success: true, projectName: 'Traffic Light', libraries: [] })
  })

  it('reports a failed IPC call rather than throwing at the caller', async () => {
    ;(window.bridge.runtimeRetrieveProject as jest.Mock).mockRejectedValue(new Error('retrieve failed'))
    const result = await adapter.retrieveProject!('192.168.1.100')

    expect(result).toEqual({ success: false, error: 'retrieve failed' })
  })
})

describe('installRetrievedLibraries', () => {
  it('delegates to bridge with the project path and the names to install', async () => {
    const result = await adapter.installRetrievedLibraries!({ projectName: 'Demo', payload: '/projects/demo' }, [
      'oscat-basic',
    ])

    expect(window.bridge.runtimeInstallRetrievedLibraries).toHaveBeenCalledWith('/projects/demo', ['oscat-basic'])
    expect(result).toEqual({ success: true, installed: ['oscat-basic'], failed: [] })
  })

  it('reports the failure in the shape the caller renders, not as a thrown error', async () => {
    // The caller lists failures per library, so a whole-call failure still has
    // to arrive as one -- an empty name with the reason attached.
    ;(window.bridge.runtimeInstallRetrievedLibraries as jest.Mock).mockRejectedValue(new Error('install failed'))
    const result = await adapter.installRetrievedLibraries!({ projectName: 'Demo', payload: '/projects/demo' }, [
      'oscat-basic',
    ])

    expect(result).toEqual({
      success: false,
      installed: [],
      failed: [{ name: '', error: 'install failed' }],
    })
  })
})

// ---------------------------------------------------------------------------
// the shared retrieve picker's desktop half
// ---------------------------------------------------------------------------
//
// The picker is one component for both platforms. What these translate is the
// desktop's answer to "which devices, and how do I address them": a LAN scan,
// keyed by address.

describe('listRetrievableDevices', () => {
  it('maps LAN replies into the shape the picker reads', async () => {
    ;(window.bridge.runtimeDiscoverDevices as jest.Mock).mockResolvedValue({
      success: true,
      devices: [
        {
          ipAddress: '192.168.1.50',
          hostname: 'plc-1',
          projectName: 'Traffic Light',
          projectTimestamp: '2026-08-31T12:00:00Z',
        },
      ],
    })

    const result = await adapter.listRetrievableDevices!()

    expect(result.success).toBe(true)
    expect(result.success && result.devices).toEqual([
      {
        key: '192.168.1.50',
        name: '192.168.1.50',
        location: 'plc-1',
        answeredScan: true,
        projectName: 'Traffic Light',
        projectTimestamp: '2026-08-31T12:00:00Z',
      },
    ])
  })

  it('marks every listed device as having answered', async () => {
    // On this platform a device is only in the list because it replied to the
    // scan, so "stores nothing" is always a real answer here -- unlike web,
    // where the device list and the scan are separate facts.
    ;(window.bridge.runtimeDiscoverDevices as jest.Mock).mockResolvedValue({
      success: true,
      devices: [{ ipAddress: '192.168.1.51', hostname: '' }],
    })

    const result = await adapter.listRetrievableDevices!()
    const [device] = result.success ? result.devices : []

    expect(device.answeredScan).toBe(true)
    expect(device.projectName).toBeUndefined()
    expect(device.location).toBeUndefined()
  })

  it('reports a failed scan rather than an empty network', async () => {
    ;(window.bridge.runtimeDiscoverDevices as jest.Mock).mockResolvedValue({
      success: false,
      error: 'no interface',
    })

    const result = await adapter.listRetrievableDevices!()

    expect(result).toEqual({ success: false, error: 'no interface' })
  })
})

describe('connectedRetrievableDeviceKey', () => {
  it('is empty until a session actually exists', async () => {
    // A configured address is not a session. Without this the picker would skip
    // asking for credentials for a device nobody has signed in to.
    expect(adapter.connectedRetrievableDeviceKey!()).toBe('')

    await adapter.login({ username: 'admin', password: 'secret' })

    expect(adapter.connectedRetrievableDeviceKey!()).toBe('192.168.1.100')
  })
})

describe('fetchRetrievableProject', () => {
  const device = { key: '192.168.1.50', name: '192.168.1.50', answeredScan: true }

  it('carries the scratch directory through as the payload', async () => {
    ;(window.bridge.runtimeRetrieveProject as jest.Mock).mockResolvedValue({
      success: true,
      projectPath: '/scratch/retrieved/Demo-123',
      projectName: 'Demo',
      libraries: [{ name: 'oscat-basic', version: '3.3.4', status: 'missing' }],
    })

    const result = await adapter.fetchRetrievableProject!(device)

    expect(window.bridge.runtimeRetrieveProject).toHaveBeenCalledWith('192.168.1.50')
    expect(result).toEqual({
      success: true,
      project: {
        projectName: 'Demo',
        payload: '/scratch/retrieved/Demo-123',
        libraries: [{ name: 'oscat-basic', version: '3.3.4', status: 'missing' }],
      },
    })
  })

  it('reports a device that returned nothing', async () => {
    ;(window.bridge.runtimeRetrieveProject as jest.Mock).mockResolvedValue({
      success: false,
      error: 'That device is not storing a project.',
    })

    const result = await adapter.fetchRetrievableProject!(device)

    expect(result).toEqual({ success: false, error: 'That device is not storing a project.' })
  })
})

describe('onRetrievableDeviceFound', () => {
  it('translates each streamed reply as it arrives', () => {
    // The LAN scan answers progressively, so rows appear while it is still
    // running rather than all at once when it ends.
    let emit: ((event: unknown, device: unknown) => void) | undefined
    const unsubscribe = jest.fn()
    ;(window.bridge.onRuntimeDeviceDiscovered as jest.Mock).mockImplementation((handler) => {
      emit = handler as (event: unknown, device: unknown) => void
      return unsubscribe
    })

    const seen: Array<{ key: string; projectName?: string }> = []
    const stop = adapter.onRetrievableDeviceFound!((device) => seen.push(device))

    emit?.({}, { ipAddress: '192.168.1.60', hostname: 'plc-9', projectName: 'Bottling' })

    expect(seen).toEqual([
      {
        key: '192.168.1.60',
        name: '192.168.1.60',
        location: 'plc-9',
        answeredScan: true,
        projectName: 'Bottling',
        projectTimestamp: undefined,
      },
    ])

    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })
})

describe('selectRetrievableDevice', () => {
  it('moves the target address the adapter authenticates against', async () => {
    // This has to happen before the login, not with it: the adapter reads its
    // target from the store to know which device to sign in to.
    const { openPLCStoreBase } = await import('../../../../frontend/store')

    adapter.selectRetrievableDevice!({ key: '192.168.1.77', name: '192.168.1.77', answeredScan: true })

    expect(openPLCStoreBase.getState().deviceDefinitions.configuration.runtimeIpAddress).toBe('192.168.1.77')
  })
})
