import type { DevicePin, IoMappingEntry } from '../../middleware/shared/ports/types'
import { runsModbusMaster, type TargetCapabilities } from '../../middleware/shared/utils/target-capabilities'
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
   *  when EITHER Modbus master (`capabilities.modbusTcpMaster` or
   *  `capabilities.modbusRtuMaster`) or `capabilities.ethercat` is true. */
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

  const remoteGroups =
    runsModbusMaster(capabilities) || capabilities.ethercat ? buildRemoteDeviceOptionGroups(cellId, remoteIOPoints) : []
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
