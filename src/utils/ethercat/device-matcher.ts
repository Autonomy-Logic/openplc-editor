/**
 * EtherCAT Device Matcher Utility
 *
 * Provides functions to match scanned EtherCAT devices against ESI repository items.
 */

import type { EtherCATDevice } from '@root/types/ethercat'
import type {
  DeviceMatch,
  DeviceMatchQuality,
  ESIRepositoryItem,
  ScannedDeviceMatch,
} from '@root/types/ethercat/esi-types'

/**
 * Parse a hex string to a number for comparison
 * Handles formats: "0x1234", "#x1234", "1234"
 */
function parseHexToNumber(hexString: string): number {
  const cleaned = hexString.replace('#x', '0x').replace('#X', '0x')
  return parseInt(cleaned, 16) || 0
}

/**
 * Determine the match quality between a scanned device and an ESI device
 */
function getMatchQuality(
  scannedVendorId: number,
  scannedProductCode: number,
  scannedRevision: number,
  esiVendorId: string,
  esiProductCode: string,
  esiRevisionNo: string,
): DeviceMatchQuality {
  const esiVendorNum = parseHexToNumber(esiVendorId)
  const esiProductNum = parseHexToNumber(esiProductCode)
  const esiRevisionNum = parseHexToNumber(esiRevisionNo)

  // Check vendor ID first - must match for any level of match
  if (scannedVendorId !== esiVendorNum) {
    return 'none'
  }

  // Check product code - must match for partial or exact
  if (scannedProductCode !== esiProductNum) {
    return 'none'
  }

  // Check revision - exact match requires revision match
  if (scannedRevision === esiRevisionNum) {
    return 'exact'
  }

  // Vendor and product match, but different revision
  return 'partial'
}

/**
 * Find all matches for a single scanned device in the repository
 */
function findMatchesForDevice(scannedDevice: EtherCATDevice, repository: ESIRepositoryItem[]): DeviceMatch[] {
  const matches: DeviceMatch[] = []

  for (const repoItem of repository) {
    const esiVendorId = repoItem.vendor.id

    for (let deviceIndex = 0; deviceIndex < repoItem.devices.length; deviceIndex++) {
      const esiDevice = repoItem.devices[deviceIndex]
      const matchQuality = getMatchQuality(
        scannedDevice.vendor_id,
        scannedDevice.product_code,
        scannedDevice.revision,
        esiVendorId,
        esiDevice.type.productCode,
        esiDevice.type.revisionNo,
      )

      if (matchQuality !== 'none') {
        matches.push({
          repositoryItemId: repoItem.id,
          deviceIndex,
          matchQuality,
          esiDevice,
        })
      }
    }
  }

  // Sort matches: exact first, then partial
  matches.sort((a, b) => {
    if (a.matchQuality === 'exact' && b.matchQuality !== 'exact') return -1
    if (a.matchQuality !== 'exact' && b.matchQuality === 'exact') return 1
    return 0
  })

  return matches
}

/**
 * Match an array of scanned devices against the ESI repository
 *
 * @param scannedDevices - Array of devices discovered via network scan
 * @param repository - Array of loaded ESI repository items
 * @returns Array of ScannedDeviceMatch objects with match information
 */
export function matchDevicesToRepository(
  scannedDevices: EtherCATDevice[],
  repository: ESIRepositoryItem[],
): ScannedDeviceMatch[] {
  return scannedDevices.map((device) => {
    const matches = findMatchesForDevice(device, repository)

    return {
      device: {
        position: device.position,
        name: device.name,
        vendor_id: device.vendor_id,
        product_code: device.product_code,
        revision: device.revision,
        serial_number: device.serial_number,
        state: device.state,
        input_bytes: device.input_bytes,
        output_bytes: device.output_bytes,
      },
      matches,
      // Auto-select the best match if there's an exact match
      selectedMatch:
        matches.length > 0 && matches[0].matchQuality === 'exact'
          ? {
              repositoryItemId: matches[0].repositoryItemId,
              deviceIndex: matches[0].deviceIndex,
            }
          : undefined,
    }
  })
}

/**
 * Get the best match quality from a list of matches
 */
export function getBestMatchQuality(matches: DeviceMatch[]): DeviceMatchQuality {
  if (matches.length === 0) return 'none'
  if (matches.some((m) => m.matchQuality === 'exact')) return 'exact'
  if (matches.some((m) => m.matchQuality === 'partial')) return 'partial'
  return 'none'
}

/**
 * Count devices by match quality
 */
export function countMatchedDevices(deviceMatches: ScannedDeviceMatch[]): {
  exact: number
  partial: number
  none: number
  total: number
} {
  let exact = 0
  let partial = 0
  let none = 0

  for (const dm of deviceMatches) {
    const bestQuality = getBestMatchQuality(dm.matches)
    if (bestQuality === 'exact') exact++
    else if (bestQuality === 'partial') partial++
    else none++
  }

  return { exact, partial, none, total: deviceMatches.length }
}
