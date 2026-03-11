import type { BoardInfo, CommunicationPort, DevicePin, PlcStatus, TimingStats } from '../../providers/platform/ports/types'
import type {
  ConnectionStatus,
  DeviceActions,
  DeviceAvailableOptions,
  DevicePinMapping,
  DeviceSlice,
  DeviceState,
  PinUpdateResponse,
  RTUConfigParam,
  RuntimeConnection,
  SelectedDevice,
  StoredCredentials,
  TCPConfigParam,
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
        availableRTUInterfaces: ['Serial'],
        availableRTUBaudRates: ['9600'],
        availableTCPInterfaces: ['Ethernet'],
      }
      expect(opts.availableBoards).toBeInstanceOf(Map)
      expect(opts.availableCommunicationPorts).toEqual([])
      expect(opts.availableRTUInterfaces).toEqual(['Serial'])
      expect(opts.availableRTUBaudRates).toEqual(['9600'])
      expect(opts.availableTCPInterfaces).toEqual(['Ethernet'])
    })
  })

  // -----------------------------------------------------------------------
  // DevicePinMapping
  // -----------------------------------------------------------------------
  describe('DevicePinMapping', () => {
    it('has pins array and selected row', () => {
      const mapping: DevicePinMapping = {
        pins: [],
        currentSelectedPinTableRow: -1,
      }
      expect(mapping.pins).toEqual([])
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
        ipAddress: null,
        selectedDevice: null,
        storedCredentials: null,
        timingStats: null,
        includeTimingStatsInPolling: false,
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
      }
      const conn: RuntimeConnection = {
        jwtToken: 'token',
        connectionStatus: 'connected',
        plcStatus: 'RUNNING',
        ipAddress: '192.168.1.1',
        selectedDevice: {
          orchestratorId: 'o',
          orchestratorAgentId: 'a',
          deviceId: 'd',
          deviceName: 'n',
        },
        storedCredentials: { username: 'u', password: 'p' },
        timingStats: stats,
        includeTimingStatsInPolling: true,
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
          availableRTUInterfaces: [],
          availableRTUBaudRates: [],
          availableTCPInterfaces: [],
        },
        deviceDefinitions: {
          configuration: {
            deviceBoard: '',
            communicationPort: '',
            compileOnly: false,
            communicationConfiguration: {
              modbusRTU: {
                rtuInterface: 'Serial',
                rtuBaudRate: '9600',
                rtuSlaveId: null,
                rtuRS485ENPin: null,
              },
              modbusTCP: {
                tcpInterface: 'Ethernet',
                tcpMacAddress: null,
                tcpStaticHostConfiguration: { ipAddress: '', dns: '', gateway: '', subnet: '' },
              },
              communicationPreferences: { enabledRTU: false, enabledTCP: false, enabledDHCP: true },
            },
          },
          pinMapping: { pins: [], currentSelectedPinTableRow: -1 },
        },
        deviceUpdated: { updated: false },
        runtimeConnection: {
          jwtToken: null,
          connectionStatus: 'disconnected',
          plcStatus: null,
          ipAddress: null,
          selectedDevice: null,
          storedCredentials: null,
          timingStats: null,
          includeTimingStatsInPolling: false,
        },
      }
      expect(state.deviceAvailableOptions).toBeDefined()
      expect(state.deviceDefinitions).toBeDefined()
      expect(state.deviceUpdated).toBeDefined()
      expect(state.runtimeConnection).toBeDefined()
    })

    it('supports optional temporaryDhcpIp', () => {
      const state: DeviceState = {
        deviceAvailableOptions: {
          availableBoards: new Map(),
          availableCommunicationPorts: [],
          availableRTUInterfaces: [],
          availableRTUBaudRates: [],
          availableTCPInterfaces: [],
        },
        deviceDefinitions: {
          configuration: {
            deviceBoard: '',
            communicationPort: '',
            compileOnly: false,
            communicationConfiguration: {
              modbusRTU: { rtuInterface: 'Serial', rtuBaudRate: '9600', rtuSlaveId: null, rtuRS485ENPin: null },
              modbusTCP: {
                tcpInterface: 'Ethernet',
                tcpMacAddress: null,
                tcpStaticHostConfiguration: { ipAddress: '', dns: '', gateway: '', subnet: '' },
              },
              communicationPreferences: { enabledRTU: false, enabledTCP: false, enabledDHCP: true },
            },
          },
          pinMapping: { pins: [], currentSelectedPinTableRow: -1 },
          temporaryDhcpIp: '10.0.0.1',
        },
        deviceUpdated: { updated: false },
        runtimeConnection: {
          jwtToken: null,
          connectionStatus: 'disconnected',
          plcStatus: null,
          ipAddress: null,
          selectedDevice: null,
          storedCredentials: null,
          timingStats: null,
          includeTimingStatsInPolling: false,
        },
      }
      expect(state.deviceDefinitions.temporaryDhcpIp).toBe('10.0.0.1')
    })
  })

  // -----------------------------------------------------------------------
  // RTUConfigParam
  // -----------------------------------------------------------------------
  describe('RTUConfigParam', () => {
    it('accepts rtuInterface variant', () => {
      const param: RTUConfigParam = { rtuConfig: 'rtuInterface', value: 'Serial2' }
      expect(param.rtuConfig).toBe('rtuInterface')
    })

    it('accepts rtuBaudRate variant', () => {
      const param: RTUConfigParam = { rtuConfig: 'rtuBaudRate', value: '115200' }
      expect(param.rtuConfig).toBe('rtuBaudRate')
    })

    it('accepts rtuSlaveId variant', () => {
      const param: RTUConfigParam = { rtuConfig: 'rtuSlaveId', value: 5 }
      expect(param.value).toBe(5)
    })

    it('accepts rtuRS485ENPin variant', () => {
      const param: RTUConfigParam = { rtuConfig: 'rtuRS485ENPin', value: null }
      expect(param.value).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // TCPConfigParam
  // -----------------------------------------------------------------------
  describe('TCPConfigParam', () => {
    it('accepts tcpInterface variant', () => {
      const param: TCPConfigParam = { tcpConfig: 'tcpInterface', value: 'Wi-Fi' }
      expect(param.tcpConfig).toBe('tcpInterface')
    })

    it('accepts tcpMacAddress variant', () => {
      const param: TCPConfigParam = { tcpConfig: 'tcpMacAddress', value: 'AA:BB:CC:DD:EE:FF' }
      expect(param.value).toBe('AA:BB:CC:DD:EE:FF')
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
        data: { pin: 'A0', pinType: 'digitalInput', address: '%IX0.0', name: 'sensor' },
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
        'setCommunicationPreferences',
        'setRTUConfig',
        'setTCPConfig',
        'setWifiConfig',
        'setStaticHostConfiguration',
        'setCompileOnly',
        'setRuntimeIpAddress',
        'setRuntimeJwtToken',
        'setRuntimeConnectionStatus',
        'setPlcRuntimeStatus',
        'setSelectedDevice',
        'setStoredCredentials',
        'setTimingStats',
        'setIncludeTimingStatsInPolling',
        'setTemporaryDhcpIp',
        'clearRuntimeConnection',
      ]
      expect(actionKeys).toHaveLength(26)
    })
  })
})
