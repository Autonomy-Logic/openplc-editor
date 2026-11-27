import type { PackageManifest } from '../../ports/types'
import { readRs485PinMap } from '../modbus-server-profile/baud'

/** Manifest device the mapping reads. */
export type ManifestDevice = PackageManifest['devices'][number]

/** Hardware fields a board takes from its manifest device, carried only when the device declares them. */
export interface BoardHardware {
  serialPorts?: string[]
  defaultSerial?: string
  networkInterfaces?: string[]
  rs485FixedPins?: Record<string, string>
}

/**
 * The hardware fields of a manifest device, as `BoardInfo` and `BoardBuildInfo` carry them on every
 * platform. `rs485FixedPins` keeps only its string entries.
 */
export function boardHardwareFromManifestDevice(device: ManifestDevice): BoardHardware {
  const rs485FixedPins = readRs485PinMap(device.rs485FixedPins)
  return {
    ...(device.serialPorts ? { serialPorts: device.serialPorts } : {}),
    ...(device.defaultSerial ? { defaultSerial: device.defaultSerial } : {}),
    ...(device.networkInterfaces ? { networkInterfaces: device.networkInterfaces } : {}),
    ...(rs485FixedPins ? { rs485FixedPins } : {}),
  }
}
