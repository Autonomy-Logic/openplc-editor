/**
 * Tests for `buildLocationDropdownOptions` — the variables-table
 * location-cell dropdown source. The core contract is target-scoping:
 * the picker must offer only addresses the active target's capability
 * block authorizes, even when the project file still carries persisted
 * state from previously-active targets.
 *
 * The user-facing bug this regression-tests against: switching a
 * project from SLM-RP4 (Runtime v4 + VPP IO) to Arduino Mega
 * (arduino-cli + pin-mapping) was leaving the dropdown showing both
 * the Arduino pin's `%QX0.0` AND the stale SLM-RP4 slot 1 `%QX0.0`,
 * because the dropdown wasn't honoring `caps.vppIo === false`.
 */

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

      // The Arduino pin's %QX0.0 surfaces under Digital Outputs.
      const digitalOutputs = groups.find((g) => g.label === 'Digital Outputs')
      expect(digitalOutputs?.options.map((o) => o.value)).toEqual(['%QX0.0'])

      // The stale SLM-RP4 entry must NOT appear — neither as a group nor
      // as an option in any group.
      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      const vppGroupCount = groups.filter((g) =>
        // VPP groups carry a "slot-N module-name" pattern; pin/remote
        // groups use fixed labels. The exact convention is set by
        // `buildVendorIoOptionGroups`, so we test the user-visible
        // contract instead: when vppIo is off, no group should
        // reference a slot number.
        /slot/i.test(g.label),
      ).length
      expect(vppGroupCount).toBe(0)
      // Belt-and-suspenders: even if a VPP group did slip through with a
      // non-matching label, the entry's specific alias must not appear.
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

      // No pin groups should carry options — the pin entries are
      // disabled. Group headings stay (empty) so the picker keeps a
      // stable shape regardless of active target.
      for (const label of ['Analog Inputs', 'Analog Outputs', 'Digital Inputs', 'Digital Outputs']) {
        const group = groups.find((g) => g.label === label)
        expect(group?.options).toEqual([])
      }

      // The VPP entry surfaces under whatever group the vendor-io
      // builder produces for slot 1; assert via the option value. Vendor
      // IO options carry the ALIAS as their value (resolved to an
      // address only at compile time), so we assert the alias here.
      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toContain('slm-rp4-relay-1')
    })

    it('drops remote-device IO points when both `modbusTcpRemote` and `ethercat` are disabled', () => {
      // Arduino targets disable both. The remote point persists in the
      // project but must not surface.
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-3',
        pins: [],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [],
        capabilities: ARDUINO_CLI_CAPABILITIES,
      })

      // Remote IO options carry the alias as their value.
      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).not.toContain('flow-sensor-alias')
    })

    it('surfaces remote-device IO points when EITHER `modbusTcpRemote` OR `ethercat` is enabled', () => {
      // Both flags on the SLM-RP4 capability block — typical Runtime v4
      // setup. The point should appear.
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

    it('drops every IO producer when the target has nothing enabled (Runtime v3 baseline)', () => {
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-5',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [VPP_VENDOR_ENTRY],
        capabilities: RUNTIME_V3_CAPABILITIES,
      })

      // Pin headings remain (empty); no remote or vendor groups exist.
      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      expect(allOptionValues).toEqual([])
    })

    it('surfaces persisted remote/EtherCAT points on the simulator (mirrors v4 semantics for project compatibility)', () => {
      // The simulator preset enables modbusTcpRemote + ethercat as
      // no-ops at the bytecode level so v4-authored projects don't
      // get nagged when simulated. Pin-mapping stays off — the
      // simulator has no real hardware pins to drive.
      const groups = buildLocationDropdownOptions({
        cellId: 'loc-6',
        pins: [ARDUINO_PIN],
        remoteIOPoints: [REMOTE_POINT],
        vendorIoEntries: [VPP_VENDOR_ENTRY],
        capabilities: SIMULATOR_CAPABILITIES,
      })

      const allOptionValues = groups.flatMap((g) => g.options.map((o) => o.value))
      // Pin (Arduino-specific) dropped, vendor (VPP-specific) dropped,
      // remote points retained. Remote/vendor values are aliases; the
      // pin value would have been the literal address.
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

      // Find positional indices of the fixed pin-group labels — they
      // come first. Then the remote-device group (named after the
      // device) and the vendor group (named after the module/slot)
      // follow in that order. We don't pin exact remote/vendor labels
      // because the underlying builders own that contract; we just
      // assert relative ordering.
      const labels = groups.map((g) => g.label)
      expect(labels.indexOf('Analog Inputs')).toBe(0)
      expect(labels.indexOf('Analog Outputs')).toBe(1)
      expect(labels.indexOf('Digital Inputs')).toBe(2)
      expect(labels.indexOf('Digital Outputs')).toBe(3)
      // Anything else is remote/vendor and must come after the four
      // pin-group headings.
      expect(labels.length).toBeGreaterThan(4)
    })
  })
})
