/**
 * Build the option groups that fill the variables-table "Location"
 * dropdown. Pure derivation from the live producer data plus the
 * active target's `TargetCapabilities` — same gating semantics the
 * shared address pool uses, surfaced at the UI layer so the picker
 * only offers addresses the active target can actually drive.
 *
 * Why this gate matters: the project file persists every producer's
 * state on disk regardless of which target is active (so switching
 * SLM-RP4 → Arduino Mega → back doesn't lose work). Without the gate,
 * the dropdown would offer addresses from producers the active target
 * has deactivated — e.g. an SLM-RP4 slot 1 entry still showing while
 * the user is targeting an Arduino Mega.
 *
 * Pin-mapping vs. VPP/remote-device dropdown asymmetry — by design:
 *   - Pin-mapping options below (`pinGroup`) list **every pin**,
 *     aliased or not.  Pin addresses on Arduino-style targets are
 *     stable hardware facts (pin 13 = `%QX0.3` on Arduino Uno,
 *     always), so addressing by raw IEC location stays meaningful
 *     even without a user-supplied alias.  An empty `(alias)` suffix
 *     just means the user hasn't given the pin a friendly name yet.
 *   - VPP/module + remote-device options (`buildVendorIoOptionGroups` /
 *     `buildRemoteDeviceOptionGroups` in `remote-device-options.ts`)
 *     list only **aliased entries**.  Their IEC addresses are
 *     allocator-assigned and can shift when the user changes slot
 *     layout, adds modules, etc.  Variables that bind to an alias
 *     survive those shifts (the alias name is stored in `location`
 *     and resolved to the current address at compile time); variables
 *     that bound to a raw address would silently break.  Requiring an
 *     alias makes the rebind-on-shift contract explicit.
 *
 * Do not "fix" the inconsistency by filtering the pin-mapping branch
 * to aliased pins only — it would force users to write an alias
 * before they can bind any variable to a pin, regressing the
 * Arduino-style "bind by raw `%IX0.0`" workflow that pre-dates the
 * alias machinery.
 */

import type { DevicePin, IoMappingEntry } from '../../middleware/shared/ports/types'
import type { TargetCapabilities } from '../../middleware/shared/utils/target-capabilities'
import {
  buildRemoteDeviceOptionGroups,
  buildVendorIoOptionGroups,
  type RemoteDeviceIOPoint,
} from './remote-device-options'

type DropdownOption = {
  id: string
  value: string
  label: string
}

type DropdownGroup = {
  label: string
  options: DropdownOption[]
}

export interface BuildLocationDropdownOptionsInput {
  /** Stable identifier for the cell — folded into each option's `id`
   *  so React keys don't collide when multiple cells render the same
   *  dropdown content. */
  cellId: string
  /** Pin-mapping claims (Arduino-style fixed addresses). Honored only
   *  when `capabilities.pinMapping` is true. */
  pins: DevicePin[]
  /** Modbus TCP slave / EtherCAT remote IO points, already flattened
   *  by `remoteDeviceSelectors.useRemoteDeviceIOPoints`. Honored only
   *  when EITHER `capabilities.modbusTcpRemote` or
   *  `capabilities.ethercat` is true. */
  remoteIOPoints: RemoteDeviceIOPoint[]
  /** VPP module IO mappings from `vendorScreenData['io-mapping']`.
   *  Honored only when `capabilities.vppIo` is true. */
  vendorIoEntries: IoMappingEntry[]
  /** Active target's capability block (from `useTargetCapabilities`). */
  capabilities: TargetCapabilities
}

/**
 * Returns the dropdown's option groups, in the order the picker
 * expects: pin groups first (Analog Inputs → Analog Outputs →
 * Digital Inputs → Digital Outputs), then remote-device groups
 * (one per device), then vendor IO groups. Empty groups are kept
 * in the output (e.g. "Analog Outputs" stays as a heading with no
 * options when the active board has no analog outputs) — the
 * picker UI hides empties so callers don't need to filter.
 */
export function buildLocationDropdownOptions(input: BuildLocationDropdownOptionsInput): DropdownGroup[] {
  const { cellId, pins, remoteIOPoints, vendorIoEntries, capabilities } = input

  const pinsForActiveTarget = capabilities.pinMapping ? pins : []
  const pinGroup = (pinType: DevicePin['pinType']): DropdownOption[] =>
    pinsForActiveTarget
      .filter((pin) => pin.pinType === pinType)
      .map((pin) => ({
        id: `${cellId}-${pin.pin}`,
        value: pin.address,
        label: `${pin.address} ${pin.alias ? `(${pin.alias})` : ''}`,
      }))

  // EtherCAT and Modbus TCP slave I/O points share one bucket in the
  // dropdown — the underlying builder doesn't separate them. Surface
  // the bucket when EITHER capability is on; the pool drops claims
  // the active target can't drive at sync time.
  const remoteGroups =
    capabilities.modbusTcpRemote || capabilities.ethercat ? buildRemoteDeviceOptionGroups(cellId, remoteIOPoints) : []
  const vendorGroups = capabilities.vppIo ? buildVendorIoOptionGroups(cellId, vendorIoEntries) : []

  return [
    { label: 'Analog Inputs', options: pinGroup('analogInput') },
    { label: 'Analog Outputs', options: pinGroup('analogOutput') },
    { label: 'Digital Inputs', options: pinGroup('digitalInput') },
    { label: 'Digital Outputs', options: pinGroup('digitalOutput') },
    ...remoteGroups,
    ...vendorGroups,
  ]
}
