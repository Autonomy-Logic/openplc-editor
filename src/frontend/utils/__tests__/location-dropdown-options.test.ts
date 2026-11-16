import type { DevicePin, IoMappingEntry } from '../../../middleware/shared/ports/types'
import {
  ARDUINO_CLI_CAPABILITIES,
  RUNTIME_V3_CAPABILITIES,
  RUNTIME_V4_CAPABILITIES,
  SIMULATOR_CAPABILITIES,
  type TargetCapabilities,
} from '../../../middleware/shared/utils/target-capabilities'
import { buildLocationDropdownOptions } from '../location-dropdown-options'
import type { RemoteDeviceIOPoint } from '../remote-device-options'

const ARDUINO_PIN: DevicePin = {
  pin: '13',
  address: '%QX0.0',
  pinType: 'digitalOutput',
  alias: 'arduino-led',
}

const VPP_VENDOR_ENTRY: IoMappingEntry = {
  slot: 1,
  moduleId: 'slm-acdci-8np-rly8',
  moduleName: 'SLM-ACDCI-8NP-RLY8',
  channelName: 'RLY1',
  channelType: 'digitalOutput',
  dataType: 'BOOL',
  iecAddress: '%QX0.0',
  alias: 'slm-rp4-relay-1',
}

const REMOTE_POINT: RemoteDeviceIOPoint = {
  deviceName: 'remote-rtu-1',
  ioGroupName: 'group-a',
  ioPointId: 'point-1',
  ioPointName: 'flow-sensor',
  ioPointType: 'analogInput',
  iecLocation: '%IW0',
  alias: 'flow-sensor-alias',
}

// SLM-RP4 has a VPP capability override on top of RUNTIME_V4 — model
// it explicitly so the test pins what the manifest actually declares.
const SLM_RP4_CAPABILITIES: TargetCapabilities = { ...RUNTIME_V4_CAPABILITIES, vppIo: true }

describe('buildLocationDropdownOptions', () => {
  describe('target-scoping by capability block', () => {
    it('drops VPP vendor IO entries when the active target has `vppIo: false` (the SLM-RP4 → Arduino Mega regression)', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-1',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [],
        vendorIoEntries: [VPP_VENDOR_ENTRY],
        capabilities: ARDUINO_CLI_CAPABILITIES,
      })

      const digitalOutputs = groups.find((g) => g.label === 'Digital Outputs')
      expect(digitalOutputs?.options.map((o) => o.value)).toEqual(['%QX0.0'])

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      const vppGroupCount = groups.filter((g) => /slot/i.test(g.label)).length
      expect(vppGroupCount).toBe(0)
      expect(allOptionValues.filter((v) => v === '%QX0.0')).toHaveLength(1)
    })

    it('drops Arduino pin entries when the active target has `pinMapping: false` (the Arduino Mega → SLM-RP4 reverse)', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-2',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [],
        vendorIoEntries: [VPP_VENDOR_ENTRY],
        capabilities: SLM_RP4_CAPABILITIES,
      })

      for (const label of ['Analog Inputs', 'Analog Outputs', 'Digital Inputs', 'Digital Outputs']) {
        const group = groups.find((g) => g.label === label)
        expect(group?.options).toEqual([])
      }

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toContain('slm-rp4-relay-1')
    })

    it('drops remote-device IO points when both Modbus masters and `ethercat` are disabled', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-3',
        pins: [],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [],
        capabilities: { ...ARDUINO_CLI_CAPABILITIES, modbusTcpMaster: false, modbusRtuMaster: false },
      })

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).not.toContain('flow-sensor-alias')
    })

    it('surfaces remote-device IO points when EITHER Modbus master OR `ethercat` is enabled', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-4',
        pins: [],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [],
        capabilities: SLM_RP4_CAPABILITIES,
      })

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toContain('flow-sensor-alias')
    })

    it('surfaces remote-device IO points on a baremetal target, whose family can run an RTU master', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-7',
        pins: [],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [],
        capabilities: ARDUINO_CLI_CAPABILITIES,
      })

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toContain('flow-sensor-alias')
    })

    it('surfaces remote-device IO points on a target that runs only the TCP master', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-8',
        pins: [],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [],
        capabilities: { ...RUNTIME_V3_CAPABILITIES, modbusTcpMaster: true },
      })

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toContain('flow-sensor-alias')
    })

    it('drops every IO producer when the target has nothing enabled (Runtime v3 baseline)', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-5',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [VPP_VENDOR_ENTRY],
        capabilities: RUNTIME_V3_CAPABILITIES,
      })

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toEqual([])
    })

    it('surfaces persisted remote/EtherCAT points on the simulator (mirrors v4 semantics for project compatibility)', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-6',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [VPP_VENDOR_ENTRY],
        capabilities: SIMULATOR_CAPABILITIES,
      })

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toContain('flow-sensor-alias')
      expect(allOptionValues).not.toContain('%QX0.0')
      expect(allOptionValues).not.toContain('slm-rp4-relay-1')
    })
  })

  describe('option construction (per-row behavior, unchanged by the gating refactor)', () => {
    it('formats pin labels as `address (alias)` when an alias is present', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'cell',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [],
        vendorIoEntries: [],
        capabilities: ARDUINO_CLI_CAPABILITIES,
      })

      const digitalOutputs = groups.find((g) => g.label === 'Digital Outputs')
      expect(digitalOutputs?.options[0].label).toBe('%QX0.0 (arduino-led)')
    })

    it('formats pin labels as just the address when no alias is set', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'cell',
        pins: [{ ...ARDUINO_PIN, alias: '' }],
        remoteIOPoints: [],
        vendorIoEntries: [],
        capabilities: ARDUINO_CLI_CAPABILITIES,
      })

      const digitalOutputs = groups.find((g) => g.label === 'Digital Outputs')
      expect(digitalOutputs?.options[0].label).toBe('%QX0.0 ')
    })

    it('folds the cellId into option ids to keep React keys unique across multiple dropdowns', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'unique-cell-id',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [],
        vendorIoEntries: [],
        capabilities: ARDUINO_CLI_CAPABILITIES,
      })

      const digitalOutputs = groups.find((g) => g.label === 'Digital Outputs')
      expect(digitalOutputs?.options[0].id).toContain('unique-cell-id')
    })

    it('preserves group ordering: pin groups → remote groups → vendor groups', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'cell',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [VPP_VENDOR_ENTRY],
        capabilities: SLM_RP4_CAPABILITIES,
      })

      const labels = groups.map((g) => g.label)
      expect(labels.indexOf('Analog Inputs')).toBe(0)
      expect(labels.indexOf('Analog Outputs')).toBe(1)
      expect(labels.indexOf('Digital Inputs')).toBe(2)
      expect(labels.indexOf('Digital Outputs')).toBe(3)
      expect(labels.length).toBeGreaterThan(4)
    })
  })
})
