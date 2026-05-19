import { createStore } from 'zustand/vanilla'

import type { EtherCATRuntimeStatusResponse } from '../../../middleware/shared/ports/ethercat-types'
import type { BoardInfo, CommunicationPort, DevicePin, TimingStats } from '../../../middleware/shared/ports/types'
import { createDeviceSlice, DeviceSlice } from '../slices/device'
import { defaultDeviceConfiguration } from '../slices/device/data/types'
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
    alias: overrides?.alias ?? '',
  }
}

function makeTimingStats(overrides?: Partial<TimingStats>): TimingStats {
  return {
    tasks: overrides?.tasks ?? [
      {
        name: 'plc-task-0',
        scan_count: 100,
        scan_time_min: 1,
        scan_time_max: 10,
        scan_time_avg: 5,
        cycle_time_min: 2,
        cycle_time_max: 8,
        cycle_time_avg: 4,
        cycle_latency_min: 0,
        cycle_latency_max: 3,
        cycle_latency_avg: 1,
        overruns: 0,
      },
    ],
    ...(overrides?.plugin_stats ? { plugin_stats: overrides.plugin_stats } : {}),
  }
}

function makeEthercatStatus(overrides?: Partial<EtherCATRuntimeStatusResponse>): EtherCATRuntimeStatusResponse {
  return {
    masters: overrides?.masters ?? [
      {
        name: 'master0',
        plugin_state: 'OPERATIONAL',
        slave_count: 3,
        expected_wkc: 6,
        slaves: [],
        metrics: {
          cycle_count: 1000,
          wkc_error_count: 0,
          avg_cycle_us: 800,
          min_cycle_us: 600,
          max_cycle_us: 1200,
          min_exchange_us: 400,
          max_exchange_us: 600,
          avg_period_us: 1000,
          min_period_us: 900,
          max_period_us: 1100,
          avg_latency_us: 50,
          min_latency_us: 20,
          max_latency_us: 100,
          consecutive_wkc_errors: 0,
          recovery_attempts: 0,
        },
      },
    ],
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
      expect(rc.ethercatStatus).toBeNull()
      expect(rc.includeEthercatStatsInPolling).toBe(false)
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
      expect(cfg.communicationPort).toBe(defaultDeviceConfiguration.communicationPort)
    })

    it('sets pinMapping', () => {
      const store = makeStore()
      const pins: DevicePin[] = [makePin({ pin: 'A0', pinType: 'analogInput', address: '%IW0', alias: 'sensor' })]
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
      store.getState().deviceActions.setEthercatStatus(makeEthercatStatus())
      store.getState().deviceActions.setIncludeEthercatStatsInPolling(true)

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
      expect(rc.ethercatStatus).toBeNull()
      expect(rc.includeEthercatStatsInPolling).toBe(false)
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
        pinMapping: [makePin({ pin: 'D0', pinType: 'digitalInput', address: '%IX0.0', alias: 'pin0' })],
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
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' }), makePin({ pin: 'D1', address: '%IX0.1' })],
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
        const result = store.getState().deviceActions.updatePin({ pinType: undefined } as Partial<DevicePin>)
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
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0', alias: '' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ alias: 'Sensor1' })
        expect(result.ok).toBe(true)
        expect(result.data?.alias).toBe('Sensor1')
        expect(store.getState().deviceDefinitions.pinMapping.pins[0].alias).toBe('Sensor1')
      })

      it('returns error for empty name', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ alias: '' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Invalid Pin Alias')
      })

      it('returns error for duplicate name', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [
            makePin({ pin: 'D0', address: '%IX0.0', alias: 'Motor' }),
            makePin({ pin: 'D1', address: '%IX0.1', alias: '' }),
          ],
        })
        store.getState().deviceActions.selectPinTableRow(1)
        const result = store.getState().deviceActions.updatePin({ alias: 'Motor' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Pin Alias Already Exists')
      })

      it('returns error for invalid name characters', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)
        const result = store.getState().deviceActions.updatePin({ alias: 'invalid name' })
        expect(result.ok).toBe(false)
        expect(result.title).toBe('Invalid Pin Alias')
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
      it('falls back to empty string when updatedData.alias is undefined and validation is bypassed', () => {
        const store = makeStore()
        store.getState().deviceActions.setDeviceDefinitions({
          pinMapping: [makePin({ pin: 'D0', address: '%IX0.0', alias: 'Sensor' })],
        })
        store.getState().deviceActions.selectPinTableRow(0)

        const spy = vi.spyOn(pinsValidation, 'checkIfPinAliasIsValid').mockReturnValueOnce({
          ok: true,
          title: 'Valid Pin Alias',
          message: 'Pin alias is valid.',
        })
        const result = store.getState().deviceActions.updatePin({ alias: undefined })
        expect(result.ok).toBe(true)
        expect(result.data?.alias).toBe('')
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
        // Cast to Partial<DevicePin> to simulate an unknown key
        const result = store.getState().deviceActions.updatePin({ address: '%IX9.9' } as Partial<DevicePin>)
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
  // setEthercatStatus
  // -----------------------------------------------------------------------
  describe('setEthercatStatus', () => {
    it('sets ethercat status', () => {
      const store = makeStore()
      const status = makeEthercatStatus()
      store.getState().deviceActions.setEthercatStatus(status)
      expect(store.getState().runtimeConnection.ethercatStatus).toEqual(status)
    })

    it('clears ethercat status', () => {
      const store = makeStore()
      store.getState().deviceActions.setEthercatStatus(makeEthercatStatus())
      store.getState().deviceActions.setEthercatStatus(null)
      expect(store.getState().runtimeConnection.ethercatStatus).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // setIncludeEthercatStatsInPolling
  // -----------------------------------------------------------------------
  describe('setIncludeEthercatStatsInPolling', () => {
    it('enables ethercat stats in polling', () => {
      const store = makeStore()
      store.getState().deviceActions.setIncludeEthercatStatsInPolling(true)
      expect(store.getState().runtimeConnection.includeEthercatStatsInPolling).toBe(true)
    })

    it('disables ethercat stats in polling', () => {
      const store = makeStore()
      store.getState().deviceActions.setIncludeEthercatStatsInPolling(true)
      store.getState().deviceActions.setIncludeEthercatStatsInPolling(false)
      expect(store.getState().runtimeConnection.includeEthercatStatsInPolling).toBe(false)
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
      store.getState().deviceActions.setEthercatStatus(makeEthercatStatus())
      store.getState().deviceActions.setIncludeEthercatStatsInPolling(true)

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
      expect(rc.ethercatStatus).toBeNull()
      expect(rc.includeEthercatStatsInPolling).toBe(false)
    })

    it('does not affect device definitions', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceBoard('Custom')
      store.getState().deviceActions.clearRuntimeConnection()
      expect(store.getState().deviceDefinitions.configuration.deviceBoard).toBe('Custom')
    })
  })
})
