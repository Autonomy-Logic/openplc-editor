import { createStore } from 'zustand/vanilla'

import type { EtherCATRuntimeStatusResponse } from '../../../middleware/shared/ports/ethercat-types'
import type { BoardInfo, CommunicationPort, DevicePin, TimingStats } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice, DeviceSlice } from '../slices/device'
import { defaultDeviceConfiguration } from '../slices/device/data/types'
import * as pinsValidation from '../slices/device/validation/pins'
import { createEditorSlice } from '../slices/editor'
import { createLibrarySlice } from '../slices/library'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot } from '../slices/project/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore() {
  // The device slice reads from project + console (alias-sync trigger
  // inside setAvailableOptions); the project slice in turn now needs
  // editor + library state for its variables-text reconcile helpers.
  // Use ProjectSliceRoot (the most expansive of the cross-slice
  // unions) as the store type so every composed slice creator's
  // `getState()` resolves.
  return createStore<ProjectSliceRoot>()((...args) => ({
    ...createDeviceSlice(...args),
    ...createProjectSlice(...args),
    ...createConsoleSlice(...args),
    ...createEditorSlice(...args),
    ...createLibrarySlice(...args),
  }))
}

/**
 * Returns the active board's pin array — the post-refactor shape
 * keys pins by `configuration.deviceBoard`, so tests that used to
 * read `pinMapping.pins` directly look up the active bucket here.
 * Defaults the empty array so tests against a fresh store (where
 * no actions have created the bucket yet) still get `[]`.
 */
function activePins(state: { deviceDefinitions: DeviceSlice['deviceDefinitions'] }): DevicePin[] {
  const board = state.deviceDefinitions.configuration.deviceBoard
  return state.deviceDefinitions.pinMapping.pinsByBoard[board] ?? []
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
      expect(activePins(s)).toEqual([])
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
        configuration: { deviceBoard: 'Mega', communicationPort: 'COM3' },
      })
      const cfg = store.getState().deviceDefinitions.configuration
      expect(cfg.deviceBoard).toBe('Mega')
      expect(cfg.communicationPort).toBe('COM3')
      // defaults preserved
      expect(cfg.runtimeIpAddress).toBe(defaultDeviceConfiguration.runtimeIpAddress)
    })

    it('sets pinMapping', () => {
      const store = makeStore()
      const pins: DevicePin[] = [makePin({ pin: 'A0', pinType: 'analogInput', address: '%IW0', alias: 'sensor' })]
      store.getState().deviceActions.setDeviceDefinitions({ pinMapping: pins })
      expect(activePins(store.getState())).toEqual(pins)
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
      const beforePins = activePins(store.getState())
      store.getState().deviceActions.setDeviceDefinitions({})
      const afterPins = activePins(store.getState())
      expect(store.getState().deviceDefinitions.configuration).toEqual(defaultDeviceConfiguration)
      expect(afterPins).toEqual(beforePins)
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
      expect(activePins(store.getState())).toEqual([])
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
      const pins = activePins(store.getState())
      const { currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
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

      const pins = activePins(store.getState())
      const { currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
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

      const pins = activePins(store.getState())
      const { currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
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

      const pins = activePins(store.getState())
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
      expect(activePins(store.getState())).toHaveLength(1)
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

      const pins = activePins(store.getState())
      const { currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
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

      expect(activePins(store.getState())).toHaveLength(0)
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

      expect(activePins(store.getState())).toHaveLength(1)
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

      const pins = activePins(store.getState())
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
        expect(activePins(store.getState())[0].pin).toBe('D3')
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
        const pins = activePins(store.getState())
        const { currentSelectedPinTableRow } = store.getState().deviceDefinitions.pinMapping
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

        const pins = activePins(store.getState())
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
        expect(activePins(store.getState())[0].alias).toBe('Sensor1')
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
        expect(activePins(store.getState())[0].pin).toBe('')
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

    it('clears selectedPlatformOptions when the board actually changes', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceBoard('Arduino Nano')
      store.getState().deviceActions.setSelectedPlatformOption('cpu', 'atmega328old')
      expect(store.getState().deviceDefinitions.configuration.selectedPlatformOptions).toEqual({
        cpu: 'atmega328old',
      })

      store.getState().deviceActions.setDeviceBoard('Arduino Mega')
      expect(store.getState().deviceDefinitions.configuration.selectedPlatformOptions).toEqual({})
    })

    it('preserves selectedPlatformOptions when setDeviceBoard is called with the same board', () => {
      // No-op board reassignment shouldn't trash user's option picks.
      const store = makeStore()
      store.getState().deviceActions.setDeviceBoard('Arduino Nano')
      store.getState().deviceActions.setSelectedPlatformOption('cpu', 'atmega328old')

      store.getState().deviceActions.setDeviceBoard('Arduino Nano')
      expect(store.getState().deviceDefinitions.configuration.selectedPlatformOptions).toEqual({
        cpu: 'atmega328old',
      })
    })
  })

  // -----------------------------------------------------------------------
  // Per-target pin scoping — regression for the SLM-RP4 → Mega → MKR
  // → Mega chain. Each target has its own pinout (a Mega's pin 13
  // doesn't exist on a MKR), so pins must NEVER leak between boards.
  // Per-board persistence is the chosen contract: a user's work on
  // board A survives a switch to board B and reappears when they
  // come back to A.
  // -----------------------------------------------------------------------
  describe('per-target pin-mapping scoping', () => {
    it('isolates pin entries across boards: pin 13 defined on Mega does NOT appear on MKR', () => {
      const store = makeStore()
      const actions = store.getState().deviceActions

      actions.setDeviceBoard('Arduino Mega')
      actions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: '13', pinType: 'digitalOutput', address: '%QX0.0' })],
      })
      expect(activePins(store.getState())).toHaveLength(1)
      expect(activePins(store.getState())[0].pin).toBe('13')

      actions.setDeviceBoard('Arduino MKR WiFi 1010')
      expect(activePins(store.getState())).toHaveLength(0)
    })

    it('preserves each board’s pins across a board switch: Mega → MKR → back to Mega restores pin 13', () => {
      const store = makeStore()
      const actions = store.getState().deviceActions

      actions.setDeviceBoard('Arduino Mega')
      actions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: '13', pinType: 'digitalOutput', address: '%QX0.0', alias: 'led-13' })],
      })

      actions.setDeviceBoard('Arduino MKR WiFi 1010')
      expect(activePins(store.getState())).toHaveLength(0)
      // Adding a pin on MKR mutates MKR's bucket only.
      actions.createNewPin()
      expect(activePins(store.getState())).toHaveLength(1)

      // Back to Mega — pin 13 with its alias must be intact.
      actions.setDeviceBoard('Arduino Mega')
      const megaPins = activePins(store.getState())
      expect(megaPins).toHaveLength(1)
      expect(megaPins[0].pin).toBe('13')
      expect(megaPins[0].alias).toBe('led-13')
      // And MKR's bucket still carries its own pin (untouched by the
      // Mega-side mutations).
      expect(store.getState().deviceDefinitions.pinMapping.pinsByBoard['Arduino MKR WiFi 1010']).toHaveLength(1)
    })

    it('resets the selected-row pointer when the board changes so the new board’s table starts unselected', () => {
      const store = makeStore()
      const actions = store.getState().deviceActions

      actions.setDeviceBoard('Arduino Mega')
      actions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: '13', pinType: 'digitalOutput', address: '%QX0.0' })],
      })
      actions.selectPinTableRow(0)
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(0)

      // Switching boards must clear the row pointer — the new board's
      // bucket may be empty or have a different row count, and a
      // dangling pointer would crash the table's "currently selected
      // pin" rendering.
      actions.setDeviceBoard('Arduino MKR WiFi 1010')
      expect(store.getState().deviceDefinitions.pinMapping.currentSelectedPinTableRow).toBe(-1)
    })

    it('createNewPin / removePin / updatePin all mutate only the active board’s bucket', () => {
      const store = makeStore()
      const actions = store.getState().deviceActions

      // Seed Mega with one pin so it's identifiable.
      actions.setDeviceBoard('Arduino Mega')
      actions.setDeviceDefinitions({
        pinMapping: [makePin({ pin: '13', pinType: 'digitalOutput', address: '%QX0.0', alias: 'led-13' })],
      })

      // Switch to MKR and drive a representative mutating action.
      actions.setDeviceBoard('Arduino MKR WiFi 1010')
      actions.createNewPin()
      actions.selectPinTableRow(0)
      actions.updatePin({ pin: 'A0' })

      // Mega's bucket is unchanged by the MKR-side mutation.
      const megaBucket = store.getState().deviceDefinitions.pinMapping.pinsByBoard['Arduino Mega']
      expect(megaBucket).toHaveLength(1)
      expect(megaBucket[0].pin).toBe('13')
      expect(megaBucket[0].alias).toBe('led-13')

      // MKR's bucket has the new pin under its own key.
      const mkrBucket = store.getState().deviceDefinitions.pinMapping.pinsByBoard['Arduino MKR WiFi 1010']
      expect(mkrBucket).toHaveLength(1)
      expect(mkrBucket[0].pin).toBe('A0')

      // Removing the MKR pin doesn't touch Mega.
      actions.removePin()
      expect(store.getState().deviceDefinitions.pinMapping.pinsByBoard['Arduino MKR WiFi 1010']).toHaveLength(0)
      expect(store.getState().deviceDefinitions.pinMapping.pinsByBoard['Arduino Mega']).toHaveLength(1)
    })

    it('migrates a legacy flat-array `pinMapping` to the active board’s bucket on load', () => {
      // Projects saved before per-board scoping wrote a flat array.
      // The store-side action keys that array under whatever board
      // the accompanying configuration names — so a legacy project
      // continues to work without manual migration.
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: { deviceBoard: 'Arduino Mega' },
        pinMapping: [makePin({ pin: '13', pinType: 'digitalOutput', address: '%QX0.0' })],
      })

      const byBoard = store.getState().deviceDefinitions.pinMapping.pinsByBoard
      expect(Object.keys(byBoard)).toEqual(['Arduino Mega'])
      expect(byBoard['Arduino Mega']).toHaveLength(1)
      expect(byBoard['Arduino Mega'][0].pin).toBe('13')
    })

    it('accepts the canonical per-board dict shape verbatim', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: { deviceBoard: 'Arduino Mega' },
        pinMapping: {
          'Arduino Mega': [makePin({ pin: '13', pinType: 'digitalOutput', address: '%QX0.0' })],
          'Arduino MKR WiFi 1010': [makePin({ pin: 'A0', pinType: 'analogInput', address: '%IW0' })],
        },
      })

      const byBoard = store.getState().deviceDefinitions.pinMapping.pinsByBoard
      expect(byBoard['Arduino Mega']).toHaveLength(1)
      expect(byBoard['Arduino MKR WiFi 1010']).toHaveLength(1)
    })
  })

  describe('setSelectedPlatformOption', () => {
    it('stores a single key/value and marks updated', () => {
      const store = makeStore()
      store.getState().deviceActions.setSelectedPlatformOption('cpu', 'atmega328old')
      expect(store.getState().deviceDefinitions.configuration.selectedPlatformOptions).toEqual({
        cpu: 'atmega328old',
      })
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })

    it('merges multiple keys without clobbering siblings', () => {
      const store = makeStore()
      store.getState().deviceActions.setSelectedPlatformOption('cpu', 'atmega328old')
      store.getState().deviceActions.setSelectedPlatformOption('upload_speed', '57600')
      expect(store.getState().deviceDefinitions.configuration.selectedPlatformOptions).toEqual({
        cpu: 'atmega328old',
        upload_speed: '57600',
      })
    })

    it('overwrites the value when called twice with the same key', () => {
      const store = makeStore()
      store.getState().deviceActions.setSelectedPlatformOption('cpu', 'atmega328')
      store.getState().deviceActions.setSelectedPlatformOption('cpu', 'atmega328old')
      expect(store.getState().deviceDefinitions.configuration.selectedPlatformOptions).toEqual({
        cpu: 'atmega328old',
      })
    })
  })

  describe('clearSelectedPlatformOptions', () => {
    it('wipes the record and marks updated', () => {
      const store = makeStore()
      store.getState().deviceActions.setSelectedPlatformOption('cpu', 'atmega328old')
      store.getState().deviceActions.setSelectedPlatformOption('upload_speed', '57600')
      store.getState().deviceActions.clearSelectedPlatformOptions()
      expect(store.getState().deviceDefinitions.configuration.selectedPlatformOptions).toEqual({})
      expect(store.getState().deviceUpdated.updated).toBe(true)
    })
  })

  // -----------------------------------------------------------------------
  // restoreVendorScreenSlice — revert path for vendor-screen tabs
  // -----------------------------------------------------------------------
  describe('restoreVendorScreenSlice', () => {
    // The snapshot-vs-current model: the tab captures `vendorScreenData`
    // at open / last-save time, and clicking "Don't save" replays the
    // snapshot over only the keys the tab owns.  Other tabs' keys must
    // stay untouched so unrelated edits on the device editor don't get
    // rolled back at the same time.

    it('restores values for keys present in the snapshot', () => {
      const store = makeStore()
      store.getState().deviceActions.setVendorScreenData('modbus_rtu', { enabled: true, baud: '115200' })
      // Capture snapshot AFTER the first edit, simulating "tab opened
      // with these values".
      const snapshot = { modbus_rtu: { enabled: true, baud: '115200' } }
      // User then edits — flip a value the snapshot will revert.
      store.getState().deviceActions.setVendorScreenData('modbus_rtu', { enabled: false, baud: '57600' })

      store.getState().deviceActions.restoreVendorScreenSlice(['modbus_rtu'], snapshot)
      expect(store.getState().deviceDefinitions.configuration.vendorScreenData?.modbus_rtu).toEqual({
        enabled: true,
        baud: '115200',
      })
    })

    it('deletes owned keys that the snapshot does NOT contain', () => {
      // Snapshot represents the pre-tab-open state; if the user added a
      // brand-new key during the tab session, "Don't save" must drop it.
      const store = makeStore()
      store.getState().deviceActions.setVendorScreenData('modbus_rtu', { enabled: true })
      const snapshot: Record<string, unknown> = {}
      store.getState().deviceActions.restoreVendorScreenSlice(['modbus_rtu'], snapshot)
      expect(store.getState().deviceDefinitions.configuration.vendorScreenData?.modbus_rtu).toBeUndefined()
    })

    it('leaves keys outside ownedKeys untouched', () => {
      // The whole point of the ownedKeys list: other vendor-screen tabs
      // (or the device editor itself) may have written to vendorScreenData
      // in this same session.  The revert must be tab-scoped.
      const store = makeStore()
      store.getState().deviceActions.setVendorScreenData('modbus_rtu', { enabled: true })
      store.getState().deviceActions.setVendorScreenData('io-mapping', { rows: ['from-other-tab'] })

      store.getState().deviceActions.restoreVendorScreenSlice(['modbus_rtu'], { modbus_rtu: { enabled: false } })

      // modbus_rtu was reverted to snapshot…
      expect(store.getState().deviceDefinitions.configuration.vendorScreenData?.modbus_rtu).toEqual({
        enabled: false,
      })
      // …but io-mapping (out of scope) is preserved.
      expect(store.getState().deviceDefinitions.configuration.vendorScreenData?.['io-mapping']).toEqual({
        rows: ['from-other-tab'],
      })
    })

    it('initializes vendorScreenData when the store has no prior key', () => {
      // Edge: a freshly loaded device with no vendor-screen edits yet.
      // The restore path must still produce a valid object so subsequent
      // edits don't NPE.
      const store = makeStore()
      // Make sure vendorScreenData starts absent.
      expect(store.getState().deviceDefinitions.configuration.vendorScreenData).toEqual(
        defaultDeviceConfiguration.vendorScreenData,
      )
      store.getState().deviceActions.restoreVendorScreenSlice(['modbus_rtu'], { modbus_rtu: { enabled: false } })
      expect(store.getState().deviceDefinitions.configuration.vendorScreenData?.modbus_rtu).toEqual({
        enabled: false,
      })
    })
  })

  // -----------------------------------------------------------------------
  // Per-target vendor-screen scoping — VPP screens (backplane modules, IO
  // mappings, …) are board-specific. A backplane configured for SLM-RP4 must
  // not bleed into P1AM-100 when the user switches targets. Mirrors the
  // per-board pin-mapping contract: each board keeps its own bucket, work on
  // board A survives a switch to B and reappears on returning to A.
  // -----------------------------------------------------------------------
  describe('per-target vendor-screen scoping', () => {
    const vsd = (state: ReturnType<typeof store.getState>) => state.deviceDefinitions.configuration.vendorScreenData
    const archive = (state: ReturnType<typeof store.getState>) =>
      state.deviceDefinitions.configuration.vendorScreenDataByBoard
    let store: ReturnType<typeof makeStore>

    it('mirrors setVendorScreenData into the active board’s bucket', () => {
      store = makeStore()
      store.getState().deviceActions.setDeviceBoard('SLM-RP4')
      store.getState().deviceActions.setVendorScreenData('module-configuration', { slots: ['mod-a'] })

      expect(vsd(store.getState())).toEqual({ 'module-configuration': { slots: ['mod-a'] } })
      expect(archive(store.getState())?.['SLM-RP4']).toEqual({ 'module-configuration': { slots: ['mod-a'] } })
    })

    it('isolates vendor data across boards: SLM-RP4 modules do NOT appear on P1AM-100', () => {
      store = makeStore()
      store.getState().deviceActions.setDeviceBoard('SLM-RP4')
      store.getState().deviceActions.setVendorScreenData('module-configuration', { slots: ['mod-a'] })

      store.getState().deviceActions.setDeviceBoard('P1AM-100')
      // New target starts clean — no stale modules carried over.
      expect(vsd(store.getState())).toEqual({})
    })

    it('preserves each board’s vendor data across a switch and restores it on return', () => {
      store = makeStore()
      const actions = store.getState().deviceActions

      actions.setDeviceBoard('SLM-RP4')
      actions.setVendorScreenData('module-configuration', { slots: ['slm-mod'] })

      actions.setDeviceBoard('P1AM-100')
      expect(vsd(store.getState())).toEqual({})
      actions.setVendorScreenData('module-configuration', { slots: ['p1am-mod'] })

      // Back to SLM-RP4 — its modules must be intact…
      actions.setDeviceBoard('SLM-RP4')
      expect(vsd(store.getState())).toEqual({ 'module-configuration': { slots: ['slm-mod'] } })
      // …and P1AM-100's bucket still carries its own, untouched.
      expect(archive(store.getState())?.['P1AM-100']).toEqual({ 'module-configuration': { slots: ['p1am-mod'] } })
    })

    it('mirrors restoreVendorScreenSlice into the active board’s bucket', () => {
      store = makeStore()
      store.getState().deviceActions.setDeviceBoard('SLM-RP4')
      store.getState().deviceActions.setVendorScreenData('modbus_rtu', { enabled: true })
      store.getState().deviceActions.restoreVendorScreenSlice(['modbus_rtu'], { modbus_rtu: { enabled: false } })

      expect(archive(store.getState())?.['SLM-RP4']).toEqual({ modbus_rtu: { enabled: false } })
    })
  })

  // -----------------------------------------------------------------------
  // Vendor-screen data migration on load (setDeviceDefinitions →
  // mergeDeviceConfigWithDefaults → migrateVendorScreenData)
  // -----------------------------------------------------------------------
  describe('vendor-screen data migration on load', () => {
    const cfg = (store: ReturnType<typeof makeStore>) => store.getState().deviceDefinitions.configuration

    it('migrates a legacy flat blob by attributing it to the saved board', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: { deviceBoard: 'SLM-RP4', vendorScreenData: { 'module-configuration': { slots: ['x'] } } },
      })
      expect(cfg(store).vendorScreenData).toEqual({ 'module-configuration': { slots: ['x'] } })
      expect(cfg(store).vendorScreenDataByBoard).toEqual({ 'SLM-RP4': { 'module-configuration': { slots: ['x'] } } })
    })

    it('prefers the per-board archive and activates the saved board’s bucket', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: {
          deviceBoard: 'P1AM-100',
          vendorScreenDataByBoard: {
            'SLM-RP4': { 'module-configuration': { slots: ['slm'] } },
            'P1AM-100': { 'module-configuration': { slots: ['p1am'] } },
          },
        },
      })
      expect(cfg(store).vendorScreenData).toEqual({ 'module-configuration': { slots: ['p1am'] } })
    })

    it('falls back to the flat blob for the active board when the archive lacks that bucket', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: {
          deviceBoard: 'P1AM-100',
          vendorScreenData: { 'module-configuration': { slots: ['flat'] } },
          vendorScreenDataByBoard: { 'SLM-RP4': { 'module-configuration': { slots: ['slm'] } } },
        },
      })
      expect(cfg(store).vendorScreenData).toEqual({ 'module-configuration': { slots: ['flat'] } })
      // The active board's bucket is seeded from the flat blob; SLM-RP4 kept.
      expect(cfg(store).vendorScreenDataByBoard?.['P1AM-100']).toEqual({ 'module-configuration': { slots: ['flat'] } })
      expect(cfg(store).vendorScreenDataByBoard?.['SLM-RP4']).toEqual({ 'module-configuration': { slots: ['slm'] } })
    })

    it('leaves the archive untouched when the active board has no bucket and there is no flat blob', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({
        configuration: {
          deviceBoard: 'P1AM-100',
          vendorScreenDataByBoard: { 'SLM-RP4': { 'module-configuration': { slots: ['slm'] } } },
        },
      })
      expect(cfg(store).vendorScreenData).toBeUndefined()
      expect(cfg(store).vendorScreenDataByBoard).toEqual({ 'SLM-RP4': { 'module-configuration': { slots: ['slm'] } } })
    })

    it('leaves both fields undefined when neither flat nor archive is present', () => {
      const store = makeStore()
      store.getState().deviceActions.setDeviceDefinitions({ configuration: { deviceBoard: 'P1AM-100' } })
      expect(cfg(store).vendorScreenData).toBeUndefined()
      expect(cfg(store).vendorScreenDataByBoard).toBeUndefined()
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
