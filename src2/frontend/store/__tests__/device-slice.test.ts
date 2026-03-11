import type { BoardInfo, CommunicationPort, DevicePin, TimingStats } from '../../../middleware/shared/ports/types'
import { createStore } from 'zustand/vanilla'

import { createDeviceSlice, DeviceSlice } from '../slices/device'
import { defaultDeviceConfiguration } from '../slices/device/data/constants'
import * as pinsValidation from '../slices/device/validation/pins'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore() {
  return createStore<DeviceSlice>()(createDeviceSlice)
}

function makePin(overrides?: Partial<DevicePin>): DevicePin {
  return {
    pin: overrides?.pin ?? '',
    pinType: overrides?.pinType ?? 'digitalInput',
    address: overrides?.address ?? '%IX0.0',
    name: overrides?.name ?? '',
  }
}

function makeTimingStats(overrides?: Partial<TimingStats>): TimingStats {
  return {
    scan_count: overrides?.scan_count ?? 100,
    scan_time_min: overrides?.scan_time_min ?? 1,
    scan_time_max: overrides?.scan_time_max ?? 10,
    scan_time_avg: overrides?.scan_time_avg ?? 5,
    cycle_time_min: overrides?.cycle_time_min ?? 2,
    cycle_time_max: overrides?.cycle_time_max ?? 8,
    cycle_time_avg: overrides?.cycle_time_avg ?? 4,
    cycle_latency_min: overrides?.cycle_latency_min ?? 0,
    cycle_latency_max: overrides?.cycle_latency_max ?? 3,
    cycle_latency_avg: overrides?.cycle_latency_avg ?? 1,
    overruns: overrides?.overruns ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDeviceSlice', () => {
  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------
  describe('initial state', () => {
    it('has default available options', () => {
      const store = makeStore()
      const s = store.getState()
      expect(s.deviceAvailableOptions.availableBoards).toBeInstanceOf(Map)
      expect(s.deviceAvailableOptions.availableBoards.size).toBe(0)
      expect(s.deviceAvailableOptions.availableCommunicationPorts).toEqual([])
      expect(s.deviceAvailableOptions.availableRTUInterfaces).toEqual([
        'Serial',
        'Serial1',
        'Serial2',
        'Serial3',
      ])
      expect(s.deviceAvailableOptions.availableRTUBaudRates).toEqual([
        '9600',
        '14400',
        '19200',
        '38400',
        '57600',
        '115200',
      ])
      expect(s.deviceAvailableOptions.availableTCPInterfaces).toEqual(['Ethernet', 'Wi-Fi'])
    })

    it('has default device definitions', () => {
      const store = makeStore()
      const s = store.getState()
      expect(s.deviceDefinitions.configuration).toEqual(defaultDeviceConfiguration)
      expect(s.deviceDefinitions.pinMapping.pins).toEqual([])
      expect(s.deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(-1)
    })

    it('has deviceUpdated set to false', () => {
      const store = makeStore()
      expect(store.getState().deviceUpdated.updated).toBe(false)
    })

    it('has default runtime connection', () => {
      const store = makeStore()
      const rc = store.getState().runtimeConnection
      expect(rc.jwtToken).toBeNull()
      expect(rc.connectionStatus).toBe('disconnected')
      expect(rc.plcStatus).toBeNull()
      expect(rc.ipAddress).toBeNull()
      expect(rc.selectedDevice).toBeNull()
      expect(rc.storedCredentials).toBeNull()
      expect(rc.timingStats).toBeNull()
      expect(rc.includeTimingStatsInPolling).toBe(false)
    })

    it('exposes deviceActions object', () => {
      const store = makeStore()
      expect(store.getState().deviceActions).toBeDefined()
      expect(typeof store.getState().deviceActions.setAvailableOptions).toBe('function')
    })
  })

  // -----------------------------------------------------------------------
  // setAvailableOptions
  // -----------------------------------------------------------------------
  describe('setAvailableOptions', () => {
    it('sets available boards', () => {
      const store = makeStore()
      const boards = new Map<string, BoardInfo>([
        ['Arduino Uno', { compiler: 'arduino-cli', core: 'avr', preview: '', specs: {} }],
      ])
      store.getState().deviceActions.setAvailableOptions({ availableBoards: boards })
      expect(store.getState().deviceAvailableOptions.availableBoards.size).toBe(1)
      expect(store.getState().deviceAvailableOptions.availableBoards.get('Arduino Uno')).toBeDefined()
    })

    it('sets available communication ports', () => {
      const store = makeStore()
      const ports: CommunicationPort[] = [{ name: 'COM3', address: '/dev/ttyUSB0' }]
      store.getState().deviceActions.setAvailableOptions({ availableCommunicationPorts: ports })
      expect(store.getState().deviceAvailableOptions.availableCommunicationPorts).toEqual(ports)
    })

    it('does not overwrite boards when only ports given', () => {
      const store = makeStore()
      const boards = new Map<string, BoardInfo>([
        ['Board1', { compiler: 'arduino-cli', core: 'c', preview: '', specs: {} }],
      ])
      store.getState().deviceActions.setAvailableOptions({ availableBoards: boards })
      store.getState().deviceActions.setAvailableOptions({
        availableCommunicationPorts: [{ name: 'COM1', address: '/dev/tty1' }],
      })
      expect(store.getState().deviceAvailableOptions.availableBoards.size).toBe(1)
    })

    it('does not overwrite ports when only boards given', () => {
      const store = makeStore()
      const ports: CommunicationPort[] = [{ name: 'COM1', address: '/dev/tty1' }]
      store.getState().deviceActions.setAvailableOptions({ availableCommunicationPorts: ports })
      store.getState().deviceActions.setAvailableOptions({
        availableBoards: new Map<string, BoardInfo>(),
      })
      expect(store.getState().deviceAvailableOptions.availableCommunicationPorts).toEqual(ports)
    })
  })

  // -----------------------------------------------------------------------
  // setDeviceDefinitions
  // -----------------------------------------------------------------------
  describe('setDeviceDefinitions', () => {
    it('merges partial configuration with defaults', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: { deviceBoard: 'Mega', compileOnly: true },
      })
      const cfg = store.getState().deviceDefinitions.configuration
      expect(cfg.deviceBoard).toBe('Mega')
      expect(cfg.compileOnly).toBe(true)
      // defaults preserved
      expect(cfg.communicationConfiguration.modbusRTU.rtuInterface).toBe('Serial')
      expect(cfg.communicationConfiguration.modbusTCP.tcpInterface).toBe('Ethernet')
    })

    it('merges modbusRTU partially', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: {
          communicationConfiguration: {
            modbusRTU: { rtuInterface: 'Serial2', rtuBaudRate: '9600', rtuSlaveId: 5, rtuRS485ENPin: null },
            modbusTCP: defaultDeviceConfiguration.communicationConfiguration.modbusTCP,
            communicationPreferences:
              defaultDeviceConfiguration.communicationConfiguration.communicationPreferences,
          },
        },
      })
      const rtu = store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusRTU
      expect(rtu.rtuInterface).toBe('Serial2')
      expect(rtu.rtuBaudRate).toBe('9600')
    })

    it('uses default modbusTCP when provided modbusTCP has no tcpInterface', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: {
          communicationConfiguration: {
            modbusRTU: defaultDeviceConfiguration.communicationConfiguration.modbusRTU,
            modbusTCP: {
              tcpMacAddress: 'AA:BB:CC:DD:EE:FF',
              tcpStaticHostConfiguration: { ipAddress: '', dns: '', gateway: '', subnet: '' },
            } as any,
            communicationPreferences:
              defaultDeviceConfiguration.communicationConfiguration.communicationPreferences,
          },
        },
      })
      const tcp = store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP
      expect(tcp.tcpInterface).toBe('Ethernet')
      expect(tcp.tcpMacAddress).toBe('DE:AD:BE:EF:DE:AD')
    })

    it('uses provided modbusTCP when tcpInterface is present', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: {
          communicationConfiguration: {
            modbusRTU: defaultDeviceConfiguration.communicationConfiguration.modbusRTU,
            modbusTCP: {
              tcpInterface: 'Wi-Fi',
              tcpMacAddress: '11:22:33:44:55:66',
              tcpStaticHostConfiguration: { ipAddress: '10.0.0.1', dns: '8.8.8.8', gateway: '10.0.0.1', subnet: '255.255.255.0' },
            },
            communicationPreferences:
              defaultDeviceConfiguration.communicationConfiguration.communicationPreferences,
          },
        },
      })
      const tcp = store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP
      expect(tcp.tcpInterface).toBe('Wi-Fi')
      expect(tcp.tcpMacAddress).toBe('11:22:33:44:55:66')
    })

    it('sets pinMapping', () => {
      const store = makeStore()
      const pins: DevicePin[] = [
        makePin({ pin: 'A0', pinType: 'analogInput', address: '%IW0', name: 'sensor' }),
      ]
      store.getState().deviceActions.setDeviceDefinitions({ pinMapping: pins })
      expect(store.getState().deviceDefinitions.pinMapping.pins).toEqual(pins)
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(-1)
    })

    it('syncs runtimeIpAddress to runtimeConnection.ipAddress', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: { runtimeIpAddress: '192.168.0.100' },
      })
      expect(store.getState().deviceDefinitions.configuration.runtimeIpAddress).toBe('192.168.0.100')
      expect(store.getState().runtimeConnection.ipAddress).toBe('192.168.0.100')
    })

    it('does not sync ipAddress when runtimeIpAddress is empty', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: { runtimeIpAddress: '' },
      })
      expect(store.getState().runtimeConnection.ipAddress).toBeNull()
    })

    it('handles call with neither configuration nor pinMapping', () => {
      const store = makeStore()
      const before = store.getState().deviceDefinitions
      store.getState().deviceActions.setDeviceDefinitions({})
      const after = store.getState().deviceDefinitions
      expect(after.configuration).toEqual(before.configuration)
      expect(after.pinMapping.pins).toEqual(before.pinMapping.pins)
    })

  })

  // -----------------------------------------------------------------------
  // clearDeviceDefinitions
  // -----------------------------------------------------------------------
  describe('clearDeviceDefinitions', () => {
    it('resets configuration to defaults', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceBoard('Custom Board')
      store.getState().deviceActions.clearDeviceDefinitions()
      expect(store.getState().deviceDefinitions.configuration).toEqual(defaultDeviceConfiguration)
    })

    it('resets pin mapping', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [makePin()],
      })
      store.getState().deviceActions.clearDeviceDefinitions()
      expect(store.getState().deviceDefinitions.pinMapping.pins).toEqual([])
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(-1)
    })

    it('resets runtime connection', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeJwtToken('tok')
      store.getState().deviceActions.setRuntimeConnectionStatus('connected')
      store.getState().deviceActions.setPlcRuntimeStatus('RUNNING')
      store.getState().deviceActions.setRuntimeIpAddress('1.2.3.4')
      store.getState().deviceActions.setSelectedDevice({
        orchestratorId: 'o',
        orchestratorAgentId: 'a',
        deviceId: 'd',
        deviceName: 'n',
      })
      store.getState().deviceActions.setStoredCredentials({ username: 'u', password: 'p' })
      store.getState().deviceActions.setTimingStats(makeTimingStats())
      store.getState().deviceActions.setIncludeTimingStatsInPolling(true)

      store.getState().deviceActions.clearDeviceDefinitions()
      const rc = store.getState().runtimeConnection
      expect(rc.jwtToken).toBeNull()
      expect(rc.connectionStatus).toBe('disconnected')
      expect(rc.plcStatus).toBeNull()
      expect(rc.ipAddress).toBeNull()
      expect(rc.selectedDevice).toBeNull()
      expect(rc.storedCredentials).toBeNull()
      expect(rc.timingStats).toBeNull()
      expect(rc.includeTimingStatsInPolling).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // resetDeviceUpdated
  // -----------------------------------------------------------------------
  describe('resetDeviceUpdated', () => {
    it('sets deviceUpdated.updated to false', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceBoard('Board')
      expect(store.getState().deviceUpdated.updated).toBe(true)
      store.getState().deviceActions.resetDeviceUpdated()
      expect(store.getState().deviceUpdated.updated).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // selectPinTableRow
  // -----------------------------------------------------------------------
  describe('selectPinTableRow', () => {
    it('sets the selected row', () => {
      const store = makeStore()
      store.getState().deviceActions.selectPinTableRow(3)
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(3)
    })

    it('can set row to -1', () => {
      const store = makeStore()
      store.getState().deviceActions.selectPinTableRow(5)
      store.getState().deviceActions.selectPinTableRow(-1)
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(-1)
    })
  })

  // -----------------------------------------------------------------------
  // createNewPin
  // -----------------------------------------------------------------------
  describe('createNewPin', () => {
    it('creates a pin in empty table', () => {
      const store = makeStore()
      store.getState().deviceActions.createNewPin()
      const { pins, currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
      expect(pins).toHaveLength(1)
      expect(pins[0].pinType).toBe('digitalInput')
      expect(pins[0].address).toBe('%IX0.0')
      expect(currentSelectedPinTableRow).toBe(0)
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('creates a pin with reference pin (no address collision)', () => {
      const store = makeStore()
      // Seed with a pin and select it
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [
          makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0', name: 'pin0' }),
        ],
      })
      store.getState().deviceActions.selectPinTableRow(0)
      store.getState().deviceActions.createNewPin()

      const { pins, currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
      expect(pins).toHaveLength(2)
      expect(pins[1].address).toBe('%IX0.1')
      expect(pins[1].pinType).toBe('digitalInput')
      expect(currentSelectedPinTableRow).toBe(1)
    })

    it('creates a pin after highest address when address collision exists', () => {
      const store = makeStore()
      // Seed with two consecutive pins
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [
          makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' }),
          makePin({ pin: 'D1', pinType: 'digitalInput', address: '%IX0.1' }),
        ],
      })
      // Select first pin: increment would be %IX0.1 which already exists
      store.getState().deviceActions.selectPinTableRow(0)
      store.getState().deviceActions.createNewPin()

      const { pins, currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
      expect(pins).toHaveLength(3)
      // New pin should be after the highest address (%IX0.1) -> %IX0.2
      expect(pins[2].address).toBe('%IX0.2')
      expect(currentSelectedPinTableRow).toBe(2)
    })

    it('creates pin when selectedRow is -1 (no reference pin)', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' })],
      })
      // Keep selection at -1
      store.getState().deviceActions.createNewPin()

      const { pins } = store.getState().deviceDefinitions.pinMapping
      expect(pins).toHaveLength(2)
      // It should be pushed to end, using the highest existing + 1
      expect(pins[1].address).toBe('%IX0.1')
    })
  })

  // -----------------------------------------------------------------------
  // removePin
  // -----------------------------------------------------------------------
  describe('removePin', () => {
    it('does nothing when no pin is selected (row = -1)', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
      })
      // row is -1 by default from setDeviceDefinitions
      store.getState().deviceActions.removePin()
      expect(store.getState().deviceDefinitions.pinMapping.pins).toHaveLength(1)
    })

    it('removes the selected pin and decrements higher addresses', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [
          makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' }),
          makePin({ pin: 'D1', pinType: 'digitalInput', address: '%IX0.1' }),
          makePin({ pin: 'D2', pinType: 'digitalInput', address: '%IX0.2' }),
        ],
      })
      store.getState().deviceActions.selectPinTableRow(0)
      store.getState().deviceActions.removePin()

      const { pins, currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
      expect(pins).toHaveLength(2)
      // Addresses shifted down
      expect(pins[0].address).toBe('%IX0.0')
      expect(pins[1].address).toBe('%IX0.1')
      expect(currentSelectedPinTableRow).toBe(0)
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('removes last remaining pin and sets selection to -1', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
      })
      store.getState().deviceActions.selectPinTableRow(0)
      store.getState().deviceActions.removePin()

      expect(store.getState().deviceDefinitions.pinMapping.pins).toHaveLength(0)
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(-1)
    })

    it('adjusts selection when removing the last row', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [
          makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' }),
          makePin({ pin: 'D1', pinType: 'digitalInput', address: '%IX0.1' }),
        ],
      })
      store.getState().deviceActions.selectPinTableRow(1) // last row
      store.getState().deviceActions.removePin()

      expect(store.getState().deviceDefinitions.pinMapping.pins).toHaveLength(1)
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(0)
    })

    it('only decrements addresses of same pinType', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [
          makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' }),
          makePin({ pin: 'A0', pinType: 'analogInput', address: '%IW0' }),
          makePin({ pin: 'D1', pinType: 'digitalInput', address: '%IX0.1' }),
        ],
      })
      store.getState().deviceActions.selectPinTableRow(0) // remove D0
      store.getState().deviceActions.removePin()

      const pins = store.getState().deviceDefinitions.pinMapping.pins
      expect(pins).toHaveLength(2)
      // analog should be untouched
      const analog = pins.find((p) => p.pinType === 'analogInput')
      expect(analog?.address).toBe('%IW0')
      // digital was decremented
      const digital = pins.find((p) => p.pinType === 'digitalInput')
      expect(digital?.address).toBe('%IX0.0')
    })
  })

  // -----------------------------------------------------------------------
  // updatePin
  // -----------------------------------------------------------------------
  describe('updatePin', () => {
    it('returns error when no pin is selected', () => {
      const store = makeStore()
      const result = store.getState().deviceActions.updatePin({ pin: 'A0' })
      expect(result.ok).toBe(false)
      expect(result.title).toBe('No Pin Selected')
    })

    describe('pin field', () => {
      it('updates pin value', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: '', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ pin: 'D3' })
        expect(result.ok).toBe(true)
        expect(result.data?.pin).toBe('D3')
        expect(store.getState().deviceDefinitions.pinMapping.pins[0].pin).toBe('D3')
      })

      it('returns error for empty pin', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ pin: '' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Invalid Pin')
      })

      it('returns error for duplicate pin', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [
            makePin({ pin: 'D0', address: '%IX0.0' }),
            makePin({ pin: 'D1', address: '%IX0.1' }),
          ],
        })
        store.getState().deviceActions.selectPinTableRow(1)
        const result = store.getState().deviceActions.updatePin({ pin: 'D0' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Pin Already Exists')
      })

      it('returns error for invalid characters in pin', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: '', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ pin: 'D@0' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Invalid Pin')
      })
    })

    describe('pinType field', () => {
      it('changes pinType and re-addresses pin', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [
            makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' }),
            makePin({ pin: 'A0', pinType: 'analogInput', address: '%IW0' }),
          ],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ pinType: 'analogInput' })

        expect(result.ok).toBe(true)
        expect(result.data?.pinType).toBe('analogInput')
        expect(result.data?.address).toBe('%IW1')
        expect(result.message).toContain('Pin type changed')

        // Verify sorting and current selection
        const { pins, currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
        const movedPin = pins.find((p) => p.pin === 'D0')
        expect(movedPin?.pinType).toBe('analogInput')
        expect(movedPin?.address).toBe('%IW1')
        expect(currentSelectedPinTableRow).toBe(pins.indexOf(movedPin!))
      })

      it('decrements old type addresses when pin moves', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [
            makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' }),
            makePin({ pin: 'D1', pinType: 'digitalInput', address: '%IX0.1' }),
            makePin({ pin: 'D2', pinType: 'digitalInput', address: '%IX0.2' }),
          ],
        })
        store.getState().deviceActions.selectPinTableRow(0) // move D0 to analog
        store.getState().deviceActions.updatePin({ pinType: 'analogInput' })

        const pins = store.getState().deviceDefinitions.pinMapping.pins
        const digitalPins = pins.filter((p) => p.pinType === 'digitalInput')
        // After removing D0 (%IX0.0), D1 should be %IX0.0, D2 should be %IX0.1
        expect(digitalPins[0].address).toBe('%IX0.0')
        expect(digitalPins[1].address).toBe('%IX0.1')
      })

      it('falls through break when updatedData.pinType is undefined', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ pinType: undefined } as any)
        // pinType is falsy so both if-branches are skipped, hitting the break
        expect(result.ok).toBe(true)
      })

      it('returns unchanged message when pinType is same as current', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ pinType: 'digitalInput' })

        expect(result.ok).toBe(true)
        expect(result.title).toBe('Pin Type Unchanged')
        expect(result.data?.pinType).toBe('digitalInput')
        expect(result.data?.address).toBe('%IX0.0')
      })
    })

    describe('name field', () => {
      it('updates pin name', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0', name: '' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ name: 'Sensor1' })
        expect(result.ok).toBe(true)
        expect(result.data?.name).toBe('Sensor1')
        expect(store.getState().deviceDefinitions.pinMapping.pins[0].name).toBe('Sensor1')
      })

      it('returns error for empty name', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ name: '' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Invalid Pin Name')
      })

      it('returns error for duplicate name', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [
            makePin({ pin: 'D0', address: '%IX0.0', name: 'Motor' }),
            makePin({ pin: 'D1', address: '%IX0.1', name: '' }),
          ],
        })
        store.getState().deviceActions.selectPinTableRow(1)
        const result = store.getState().deviceActions.updatePin({ name: 'Motor' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Pin Name Already Exists')
      })

      it('returns error for invalid name characters', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ name: 'invalid name' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Invalid Pin Name')
      })
    })

    describe('pin field fallback branch', () => {
      it('falls back to empty string when updatedData.pin is undefined and validation is bypassed', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)

        // Mock validation to allow undefined through
        const spy = vi.spyOn(pinsValidation, 'checkIfPinIsValid').mockReturnValueOnce({
          ok: true,
          title: 'Valid Pin',
          message: 'Pin is valid.',
        })
        const result = store.getState().deviceActions.updatePin({ pin: undefined })
        expect(result.ok).toBe(true)
        expect(result.data?.pin).toBe('')
        expect(store.getState().deviceDefinitions.pinMapping.pins[0].pin).toBe('')
        spy.mockRestore()
      })
    })

    describe('name field fallback branch', () => {
      it('falls back to empty string when updatedData.name is undefined and validation is bypassed', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0', name: 'Sensor' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)

        const spy = vi.spyOn(pinsValidation, 'checkIfPinNameIsValid').mockReturnValueOnce({
          ok: true,
          title: 'Valid Pin Name',
          message: 'Pin name is valid.',
        })
        const result = store.getState().deviceActions.updatePin({ name: undefined })
        expect(result.ok).toBe(true)
        expect(result.data?.name).toBe('')
        spy.mockRestore()
      })
    })

    describe('default/unknown field', () => {
      it('passes through without error for unknown keys', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        // Cast to any to simulate an unknown key
        const result = store.getState().deviceActions.updatePin({ address: '%IX9.9' } as any)
        expect(result.ok).toBe(true)
      })
    })

    it('sets deviceUpdated to true', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
      })
      store.getState().deviceActions.selectPinTableRow(0)
      store.getState().deviceActions.resetDeviceUpdated()
      store.getState().deviceActions.updatePin({ pin: 'D5' })
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // setDeviceBoard
  // -----------------------------------------------------------------------
  describe('setDeviceBoard', () => {
    it('sets the device board and marks updated', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceBoard('Arduino Mega')
      expect(store.getState().deviceDefinitions.configuration.deviceBoard).toBe('Arduino Mega')
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // setCommunicationPort
  // -----------------------------------------------------------------------
  describe('setCommunicationPort', () => {
    it('sets the communication port and marks updated', () => {
      const store = makeStore()
      store.getState().deviceActions.setCommunicationPort('/dev/ttyUSB0')
      expect(store.getState().deviceDefinitions.configuration.communicationPort).toBe('/dev/ttyUSB0')
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // setCommunicationPreferences
  // -----------------------------------------------------------------------
  describe('setCommunicationPreferences', () => {
    it('sets enableRTU', () => {
      const store = makeStore()
      store.getState().deviceActions.setCommunicationPreferences({ enableRTU: true })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.communicationPreferences
          .enabledRTU,
      ).toBe(true)
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('sets enableTCP', () => {
      const store = makeStore()
      store.getState().deviceActions.setCommunicationPreferences({ enableTCP: true })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.communicationPreferences
          .enabledTCP,
      ).toBe(true)
    })

    it('sets enableDHCP', () => {
      const store = makeStore()
      store.getState().deviceActions.setCommunicationPreferences({ enableDHCP: false })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.communicationPreferences
          .enabledDHCP,
      ).toBe(false)
    })

    it('does partial updates without touching other preferences', () => {
      const store = makeStore()
      store.getState().deviceActions.setCommunicationPreferences({ enableRTU: true })
      store.getState().deviceActions.setCommunicationPreferences({ enableTCP: true })
      const prefs =
        store.getState().deviceDefinitions.configuration.communicationConfiguration.communicationPreferences
      expect(prefs.enabledRTU).toBe(true)
      expect(prefs.enabledTCP).toBe(true)
      expect(prefs.enabledDHCP).toBe(true) // default
    })
  })

  // -----------------------------------------------------------------------
  // setRTUConfig
  // -----------------------------------------------------------------------
  describe('setRTUConfig', () => {
    it('sets rtuInterface', () => {
      const store = makeStore()
      store.getState().deviceActions.setRTUConfig({ rtuConfig: 'rtuInterface', value: 'Serial3' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuInterface,
      ).toBe('Serial3')
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('sets rtuBaudRate', () => {
      const store = makeStore()
      store.getState().deviceActions.setRTUConfig({ rtuConfig: 'rtuBaudRate', value: '9600' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuBaudRate,
      ).toBe('9600')
    })

    it('sets rtuSlaveId', () => {
      const store = makeStore()
      store.getState().deviceActions.setRTUConfig({ rtuConfig: 'rtuSlaveId', value: 10 })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuSlaveId,
      ).toBe(10)
    })

    it('sets rtuRS485ENPin', () => {
      const store = makeStore()
      store.getState().deviceActions.setRTUConfig({ rtuConfig: 'rtuRS485ENPin', value: 'D4' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuRS485ENPin,
      ).toBe('D4')
    })

    it('sets rtuRS485ENPin to null', () => {
      const store = makeStore()
      store.getState().deviceActions.setRTUConfig({ rtuConfig: 'rtuRS485ENPin', value: null })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuRS485ENPin,
      ).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // setTCPConfig
  // -----------------------------------------------------------------------
  describe('setTCPConfig', () => {
    it('sets tcpInterface', () => {
      const store = makeStore()
      store.getState().deviceActions.setTCPConfig({ tcpConfig: 'tcpInterface', value: 'Wi-Fi' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpInterface,
      ).toBe('Wi-Fi')
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('sets tcpMacAddress', () => {
      const store = makeStore()
      store.getState().deviceActions.setTCPConfig({
        tcpConfig: 'tcpMacAddress',
        value: 'AA:BB:CC:DD:EE:FF',
      })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpMacAddress,
      ).toBe('AA:BB:CC:DD:EE:FF')
    })
  })

  // -----------------------------------------------------------------------
  // setWifiConfig
  // -----------------------------------------------------------------------
  describe('setWifiConfig', () => {
    it('sets wifi SSID when tcpInterface is Wi-Fi', () => {
      const store = makeStore()
      store.getState().deviceActions.setTCPConfig({ tcpConfig: 'tcpInterface', value: 'Wi-Fi' })
      store.getState().deviceActions.setWifiConfig({ tcpWifiSSID: 'MyNetwork' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpWifiSSID,
      ).toBe('MyNetwork')
    })

    it('sets wifi password when tcpInterface is Wi-Fi', () => {
      const store = makeStore()
      store.getState().deviceActions.setTCPConfig({ tcpConfig: 'tcpInterface', value: 'Wi-Fi' })
      store.getState().deviceActions.setWifiConfig({ tcpWifiPassword: 'secret123' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpWifiPassword,
      ).toBe('secret123')
    })

    it('does not set wifi config when tcpInterface is Ethernet', () => {
      const store = makeStore()
      // default tcpInterface is 'Ethernet'
      store.getState().deviceActions.setWifiConfig({ tcpWifiSSID: 'MyNetwork' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpWifiSSID,
      ).toBeUndefined()
    })

    it('marks deviceUpdated regardless of tcpInterface', () => {
      const store = makeStore()
      store.getState().deviceActions.setWifiConfig({ tcpWifiSSID: 'MyNetwork' })
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // setStaticHostConfiguration
  // -----------------------------------------------------------------------
  describe('setStaticHostConfiguration', () => {
    it('sets ipAddress', () => {
      const store = makeStore()
      store.getState().deviceActions.setStaticHostConfiguration({ ipAddress: '192.168.1.100' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP
          .tcpStaticHostConfiguration.ipAddress,
      ).toBe('192.168.1.100')
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('sets dns', () => {
      const store = makeStore()
      store.getState().deviceActions.setStaticHostConfiguration({ dns: '8.8.8.8' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP
          .tcpStaticHostConfiguration.dns,
      ).toBe('8.8.8.8')
    })

    it('sets gateway', () => {
      const store = makeStore()
      store.getState().deviceActions.setStaticHostConfiguration({ gateway: '192.168.1.1' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP
          .tcpStaticHostConfiguration.gateway,
      ).toBe('192.168.1.1')
    })

    it('sets subnet', () => {
      const store = makeStore()
      store.getState().deviceActions.setStaticHostConfiguration({ subnet: '255.255.255.0' })
      expect(
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP
          .tcpStaticHostConfiguration.subnet,
      ).toBe('255.255.255.0')
    })

    it('does partial updates', () => {
      const store = makeStore()
      store.getState().deviceActions.setStaticHostConfiguration({ ipAddress: '10.0.0.1' })
      store.getState().deviceActions.setStaticHostConfiguration({ dns: '1.1.1.1' })
      const hostCfg =
        store.getState().deviceDefinitions.configuration.communicationConfiguration.modbusTCP
          .tcpStaticHostConfiguration
      expect(hostCfg.ipAddress).toBe('10.0.0.1')
      expect(hostCfg.dns).toBe('1.1.1.1')
      expect(hostCfg.gateway).toBe('') // default
      expect(hostCfg.subnet).toBe('') // default
    })
  })

  // -----------------------------------------------------------------------
  // setCompileOnly
  // -----------------------------------------------------------------------
  describe('setCompileOnly', () => {
    it('sets compileOnly to true', () => {
      const store = makeStore()
      store.getState().deviceActions.setCompileOnly(true)
      expect(store.getState().deviceDefinitions.configuration.compileOnly).toBe(true)
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('sets compileOnly to false', () => {
      const store = makeStore()
      store.getState().deviceActions.setCompileOnly(true)
      store.getState().deviceActions.setCompileOnly(false)
      expect(store.getState().deviceDefinitions.configuration.compileOnly).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // setRuntimeIpAddress
  // -----------------------------------------------------------------------
  describe('setRuntimeIpAddress', () => {
    it('sets ipAddress in both configuration and runtimeConnection', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeIpAddress('10.0.0.5')
      expect(store.getState().deviceDefinitions.configuration.runtimeIpAddress).toBe('10.0.0.5')
      expect(store.getState().runtimeConnection.ipAddress).toBe('10.0.0.5')
    })
  })

  // -----------------------------------------------------------------------
  // setRuntimeJwtToken
  // -----------------------------------------------------------------------
  describe('setRuntimeJwtToken', () => {
    it('sets jwt token', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeJwtToken('my-jwt-token')
      expect(store.getState().runtimeConnection.jwtToken).toBe('my-jwt-token')
    })

    it('clears jwt token', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeJwtToken('tok')
      store.getState().deviceActions.setRuntimeJwtToken(null)
      expect(store.getState().runtimeConnection.jwtToken).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // setRuntimeConnectionStatus
  // -----------------------------------------------------------------------
  describe('setRuntimeConnectionStatus', () => {
    it('sets connection status to connected', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeConnectionStatus('connected')
      expect(store.getState().runtimeConnection.connectionStatus).toBe('connected')
    })

    it('sets connection status to connecting', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeConnectionStatus('connecting')
      expect(store.getState().runtimeConnection.connectionStatus).toBe('connecting')
    })

    it('sets connection status to error', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeConnectionStatus('error')
      expect(store.getState().runtimeConnection.connectionStatus).toBe('error')
    })

    it('sets connection status to disconnected', () => {
      const store = makeStore()
      store.getState().deviceActions.setRuntimeConnectionStatus('connected')
      store.getState().deviceActions.setRuntimeConnectionStatus('disconnected')
      expect(store.getState().runtimeConnection.connectionStatus).toBe('disconnected')
    })
  })

  // -----------------------------------------------------------------------
  // setPlcRuntimeStatus
  // -----------------------------------------------------------------------
  describe('setPlcRuntimeStatus', () => {
    it('sets PLC status to RUNNING', () => {
      const store = makeStore()
      store.getState().deviceActions.setPlcRuntimeStatus('RUNNING')
      expect(store.getState().runtimeConnection.plcStatus).toBe('RUNNING')
    })

    it('sets PLC status to null', () => {
      const store = makeStore()
      store.getState().deviceActions.setPlcRuntimeStatus('RUNNING')
      store.getState().deviceActions.setPlcRuntimeStatus(null)
      expect(store.getState().runtimeConnection.plcStatus).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // setSelectedDevice
  // -----------------------------------------------------------------------
  describe('setSelectedDevice', () => {
    it('sets selected device', () => {
      const store = makeStore()
      const device = {
        orchestratorId: 'orch-1',
        orchestratorAgentId: 'agent-1',
        deviceId: 'dev-1',
        deviceName: 'Test Device',
      }
      store.getState().deviceActions.setSelectedDevice(device)
      expect(store.getState().runtimeConnection.selectedDevice).toEqual(device)
    })

    it('clears selected device', () => {
      const store = makeStore()
      store.getState().deviceActions.setSelectedDevice({
        orchestratorId: 'o',
        orchestratorAgentId: 'a',
        deviceId: 'd',
        deviceName: 'n',
      })
      store.getState().deviceActions.setSelectedDevice(null)
      expect(store.getState().runtimeConnection.selectedDevice).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // setStoredCredentials
  // -----------------------------------------------------------------------
  describe('setStoredCredentials', () => {
    it('sets stored credentials', () => {
      const store = makeStore()
      store.getState().deviceActions.setStoredCredentials({ username: 'admin', password: 'pass' })
      expect(store.getState().runtimeConnection.storedCredentials).toEqual({
        username: 'admin',
        password: 'pass',
      })
    })

    it('clears stored credentials', () => {
      const store = makeStore()
      store.getState().deviceActions.setStoredCredentials({ username: 'u', password: 'p' })
      store.getState().deviceActions.setStoredCredentials(null)
      expect(store.getState().runtimeConnection.storedCredentials).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // setTimingStats
  // -----------------------------------------------------------------------
  describe('setTimingStats', () => {
    it('sets timing stats', () => {
      const store = makeStore()
      const stats = makeTimingStats()
      store.getState().deviceActions.setTimingStats(stats)
      expect(store.getState().runtimeConnection.timingStats).toEqual(stats)
    })

    it('clears timing stats', () => {
      const store = makeStore()
      store.getState().deviceActions.setTimingStats(makeTimingStats())
      store.getState().deviceActions.setTimingStats(null)
      expect(store.getState().runtimeConnection.timingStats).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // setIncludeTimingStatsInPolling
  // -----------------------------------------------------------------------
  describe('setIncludeTimingStatsInPolling', () => {
    it('enables timing stats in polling', () => {
      const store = makeStore()
      store.getState().deviceActions.setIncludeTimingStatsInPolling(true)
      expect(store.getState().runtimeConnection.includeTimingStatsInPolling).toBe(true)
    })

    it('disables timing stats in polling', () => {
      const store = makeStore()
      store.getState().deviceActions.setIncludeTimingStatsInPolling(true)
      store.getState().deviceActions.setIncludeTimingStatsInPolling(false)
      expect(store.getState().runtimeConnection.includeTimingStatsInPolling).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // setTemporaryDhcpIp
  // -----------------------------------------------------------------------
  describe('setTemporaryDhcpIp', () => {
    it('sets temporary DHCP IP', () => {
      const store = makeStore()
      store.getState().deviceActions.setTemporaryDhcpIp('172.16.0.1')
      expect(store.getState().deviceDefinitions.temporaryDhcpIp).toBe('172.16.0.1')
    })

    it('clears temporary DHCP IP when undefined', () => {
      const store = makeStore()
      store.getState().deviceActions.setTemporaryDhcpIp('172.16.0.1')
      store.getState().deviceActions.setTemporaryDhcpIp(undefined)
      expect(store.getState().deviceDefinitions.temporaryDhcpIp).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // clearRuntimeConnection
  // -----------------------------------------------------------------------
  describe('clearRuntimeConnection', () => {
    it('resets all runtime connection fields', () => {
      const store = makeStore()
      // Set everything
      store.getState().deviceActions.setRuntimeJwtToken('tok')
      store.getState().deviceActions.setRuntimeConnectionStatus('connected')
      store.getState().deviceActions.setPlcRuntimeStatus('RUNNING')
      store.getState().deviceActions.setRuntimeIpAddress('1.2.3.4')
      store.getState().deviceActions.setSelectedDevice({
        orchestratorId: 'o',
        orchestratorAgentId: 'a',
        deviceId: 'd',
        deviceName: 'n',
      })
      store.getState().deviceActions.setStoredCredentials({ username: 'u', password: 'p' })
      store.getState().deviceActions.setTimingStats(makeTimingStats())
      store.getState().deviceActions.setIncludeTimingStatsInPolling(true)

      store.getState().deviceActions.clearRuntimeConnection()
      const rc = store.getState().runtimeConnection
      expect(rc.jwtToken).toBeNull()
      expect(rc.connectionStatus).toBe('disconnected')
      expect(rc.plcStatus).toBeNull()
      expect(rc.ipAddress).toBeNull()
      expect(rc.selectedDevice).toBeNull()
      expect(rc.storedCredentials).toBeNull()
      expect(rc.timingStats).toBeNull()
      expect(rc.includeTimingStatsInPolling).toBe(false)
    })

    it('does not affect device definitions', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceBoard('Custom')
      store.getState().deviceActions.clearRuntimeConnection()
      expect(store.getState().deviceDefinitions.configuration.deviceBoard).toBe('Custom')
    })
  })
})
