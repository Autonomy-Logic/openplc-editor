import type { BoardInfo, CommunicationPort, TimingStats } from '../../../middleware/shared/ports/types'
import type {
  ConnectionStatus,
  DeviceActions,
  DeviceAvailableOptions,
  DevicePinMapping,
  DeviceSlice,
  DeviceState,
  PinUpdateResponse,
  RuntimeConnection,
  SelectedDevice,
  DeviceConnection,
  DeviceConnectionStatus,
  StoredCredentials,
} from '../slices/device'

// ---------------------------------------------------------------------------
// This file performs compile-time type assertions. Each test assigns a
// well-typed literal to the target type. If the types drift, `tsc` (via
// ts-jest) will flag errors here before any runtime check.
// ---------------------------------------------------------------------------

describe('Device slice types', () => {
  // -----------------------------------------------------------------------
  // DeviceAvailableOptions
  // -----------------------------------------------------------------------
  describe('DeviceAvailableOptions', () => {
    it('has the expected shape', () => {
      const opts: DeviceAvailableOptions = {
        availableBoards: new Map<string, BoardInfo>(),
        availableCommunicationPorts: [] as CommunicationPort[],
      }
      expect(opts.availableBoards).toBeInstanceOf(Map)
      expect(opts.availableCommunicationPorts).toEqual([])
    })
  })

  // -----------------------------------------------------------------------
  // DevicePinMapping
  // -----------------------------------------------------------------------
  describe('DevicePinMapping', () => {
    it('has per-board pins dict and selected row', () => {
      const mapping: DevicePinMapping = {
        pinsByBoard: {},
        currentSelectedPinTableRow: -1,
      }
      expect(mapping.pinsByBoard).toEqual({})
      expect(mapping.currentSelectedPinTableRow).toBe(-1)
    })
  })

  // -----------------------------------------------------------------------
  // SelectedDevice
  // -----------------------------------------------------------------------
  describe('SelectedDevice', () => {
    it('has orchestrator and device identifiers', () => {
      const device: SelectedDevice = {
        orchestratorId: 'orch-1',
        orchestratorAgentId: 'agent-1',
        deviceId: 'dev-1',
        deviceName: 'My Device',
      }
      expect(device.orchestratorId).toBe('orch-1')
      expect(device.orchestratorAgentId).toBe('agent-1')
      expect(device.deviceId).toBe('dev-1')
      expect(device.deviceName).toBe('My Device')
    })
  })

  // -----------------------------------------------------------------------
  // StoredCredentials
  // -----------------------------------------------------------------------
  describe('StoredCredentials', () => {
    it('has username and password', () => {
      const creds: StoredCredentials = { username: 'admin', password: 'secret' }
      expect(creds.username).toBe('admin')
      expect(creds.password).toBe('secret')
    })
  })

  // -----------------------------------------------------------------------
  // ConnectionStatus
  // -----------------------------------------------------------------------
  describe('ConnectionStatus', () => {
    it('accepts all valid status values', () => {
      const statuses: ConnectionStatus[] = ['disconnected', 'connecting', 'connected', 'error']
      expect(statuses).toHaveLength(4)
    })
  })

  // -----------------------------------------------------------------------
  // RuntimeConnection
  // -----------------------------------------------------------------------
  describe('RuntimeConnection', () => {
    it('has the expected shape with all nullable fields', () => {
      const conn: RuntimeConnection = {
        jwtToken: null,
        connectionStatus: 'disconnected',
        plcStatus: null,
        switchPosition: null,
        ipAddress: null,
        runtimeVersion: null,
        selectedDevice: null,
        storedCredentials: null,
        timingStats: null,
        includeTimingStatsInPolling: false,
        ethercatStatus: null,
        includeEthercatStatsInPolling: false,
      runtimeUpdateInProgress: false,
      }
      expect(conn.jwtToken).toBeNull()
      expect(conn.connectionStatus).toBe('disconnected')
      expect(conn.plcStatus).toBeNull()
      expect(conn.ipAddress).toBeNull()
      expect(conn.selectedDevice).toBeNull()
      expect(conn.storedCredentials).toBeNull()
      expect(conn.timingStats).toBeNull()
      expect(conn.includeTimingStatsInPolling).toBe(false)
    })

    it('accepts non-null values', () => {
      const stats: TimingStats = {
        tasks: [
          {
            name: 'plc-task-0',
            scan_count: 1,
            scan_time_min: 0,
            scan_time_max: 10,
            scan_time_avg: 5,
            cycle_time_min: 1,
            cycle_time_max: 9,
            cycle_time_avg: 4,
            cycle_latency_min: 0,
            cycle_latency_max: 2,
            cycle_latency_avg: 1,
            overruns: 0,
          },
        ],
      }
      const conn: RuntimeConnection = {
        jwtToken: 'token',
        connectionStatus: 'connected',
        plcStatus: 'RUNNING',
        switchPosition: 'run',
        ipAddress: '192.168.1.1',
        runtimeVersion: 'v4.1.9',
        selectedDevice: {
          orchestratorId: 'o',
          orchestratorAgentId: 'a',
          deviceId: 'd',
          deviceName: 'n',
        },
        storedCredentials: { username: 'u', password: 'p' },
        timingStats: stats,
        includeTimingStatsInPolling: true,
        ethercatStatus: null,
        includeEthercatStatsInPolling: false,
      runtimeUpdateInProgress: false,
      }
      expect(conn.jwtToken).toBe('token')
      expect(conn.connectionStatus).toBe('connected')
    })
  })

  // -----------------------------------------------------------------------
  // DeviceState
  // -----------------------------------------------------------------------
  describe('DeviceState', () => {
    it('has all required top-level keys', () => {
      const state: DeviceState = {
        deviceAvailableOptions: {
          availableBoards: new Map(),
          availableCommunicationPorts: [],
        },
        deviceDefinitions: {
          configuration: {
            deviceBoard: '',
            communicationPort: '',
          },
          pinMapping: { pinsByBoard: {}, currentSelectedPinTableRow: -1 },
        },
        deviceUpdated: { updated: false },
        runtimeConnection: {
          jwtToken: null,
          connectionStatus: 'disconnected',
          plcStatus: null,
          switchPosition: null,
          ipAddress: null,
          runtimeVersion: null,
          selectedDevice: null,
          storedCredentials: null,
          timingStats: null,
          includeTimingStatsInPolling: false,
          ethercatStatus: null,
          includeEthercatStatsInPolling: false,
      runtimeUpdateInProgress: false,
        },
        deviceConnection: { status: 'disconnected', port: null, transport: null, debugTransport: null },
        deviceLicense: { phase: 'idle', report: null, awaitingPurchaseUntil: null },
      }
      expect(state.deviceAvailableOptions).toBeDefined()
      expect(state.deviceDefinitions).toBeDefined()
      expect(state.deviceUpdated).toBeDefined()
      expect(state.runtimeConnection).toBeDefined()
      expect(state.deviceConnection).toBeDefined()
      // Licensing is its own top-level key, not a field on the connection: the
      // link being up and the device being entitled change for unrelated reasons.
      expect(state.deviceLicense).toBeDefined()
    })
  })

  // -----------------------------------------------------------------------
  // DeviceConnection
  // -----------------------------------------------------------------------
  describe('DeviceConnection', () => {
    it('accepts every status', () => {
      const statuses: DeviceConnectionStatus[] = ['disconnected', 'connecting', 'connected', 'error']
      const conns: DeviceConnection[] = statuses.map((status) => ({
        status,
        port: status === 'connected' ? 'COM5' : null,
        transport: status === 'connected' ? 'rtu' : null,
        debugTransport: status === 'connected' ? 'rtu' : null,
      }))
      expect(conns).toHaveLength(4)
    })
  })

  // -----------------------------------------------------------------------
  // PinUpdateResponse
  // -----------------------------------------------------------------------
  describe('PinUpdateResponse', () => {
    it('has expected shape with data', () => {
      const response: PinUpdateResponse = {
        ok: true,
        title: 'Updated',
        message: 'Success',
        data: { pin: 'A0', pinType: 'digitalInput', address: '%IX0.0', alias: 'sensor' },
      }
      expect(response.ok).toBe(true)
      expect(response.data).toBeDefined()
    })

    it('allows data to be undefined', () => {
      const response: PinUpdateResponse = {
        ok: false,
        title: 'Error',
        message: 'Failed',
      }
      expect(response.data).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // DeviceSlice
  // -----------------------------------------------------------------------
  describe('DeviceSlice', () => {
    it('is the union of DeviceState and deviceActions', () => {
      // This test verifies the type alias at compile time.
      // We only check that deviceActions is expected to be a key.
      const hasActions: keyof DeviceSlice = 'deviceActions'
      expect(hasActions).toBe('deviceActions')

      const hasState: keyof DeviceSlice = 'deviceDefinitions'
      expect(hasState).toBe('deviceDefinitions')
    })
  })

  // -----------------------------------------------------------------------
  // DeviceActions (structural check)
  // -----------------------------------------------------------------------
  describe('DeviceActions', () => {
    it('declares all expected action keys', () => {
      const actionKeys: Array<keyof DeviceActions> = [
        'setAvailableOptions',
        'setDeviceDefinitions',
        'clearDeviceDefinitions',
        'resetDeviceUpdated',
        'selectPinTableRow',
        'createNewPin',
        'removePin',
        'updatePin',
        'setDeviceBoard',
        'setCommunicationPort',
        'setRuntimeIpAddress',
        'setRuntimeJwtToken',
        'setRuntimeConnectionStatus',
        'setPlcRuntimeStatus',
        'setSelectedDevice',
        'setStoredCredentials',
        'setTimingStats',
        'setIncludeTimingStatsInPolling',
        'clearRuntimeConnection',
      ]
      expect(actionKeys).toHaveLength(19)
    })
  })
})
