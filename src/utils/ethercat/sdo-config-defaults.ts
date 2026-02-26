/**
 * SDO Configuration Defaults Extraction
 *
 * Extracts configurable SDO parameters from CoE Object Dictionary entries.
 * Filters to only include user-configurable (RW) parameters in the
 * manufacturer-specific and profile-specific ranges.
 */

import type { ESICoEObject, SDOConfigurationEntry } from '@root/types/ethercat/esi-types'

/**
 * Parse a hex index string to a number for range comparison.
 */
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('0x', ''), 16) || 0
}

/**
 * Check if an object index is in a configurable range.
 * Excludes:
 *   0x0000-0x0FFF: Data types (internal)
 *   0x1000-0x1FFF: Communication / identity parameters (managed by master)
 */
function isConfigurableRange(index: string): boolean {
  const num = hexToNumber(index)
  return num >= 0x2000
}

/**
 * Extract default SDO configurations from CoE Object Dictionary.
 *
 * Returns one SDOConfigurationEntry per RW parameter found in the
 * configurable ranges (0x2000+). For complex objects, each RW sub-item
 * (except subIndex 0 which is the max subindex counter) gets its own entry.
 */
export function extractDefaultSdoConfigurations(coeObjects: ESICoEObject[]): SDOConfigurationEntry[] {
  const entries: SDOConfigurationEntry[] = []

  for (const obj of coeObjects) {
    if (!isConfigurableRange(obj.index)) continue

    if (obj.subItems && obj.subItems.length > 0) {
      // Complex object: iterate sub-items
      for (const sub of obj.subItems) {
        const subIdx = parseInt(sub.subIndex, 10)
        // Skip subIndex 0 (max subindex counter)
        if (subIdx === 0) continue
        // Only include RW sub-items
        if (sub.access !== 'RW') continue
        // Must have a default value
        const defaultValue = sub.defaultValue ?? ''

        entries.push({
          index: obj.index,
          subIndex: subIdx,
          value: defaultValue,
          defaultValue,
          dataType: sub.type,
          bitLength: sub.bitSize,
          name: sub.name,
          objectName: obj.name,
        })
      }
    } else {
      // Simple object: use object-level values
      if (obj.access !== 'RW') continue
      const defaultValue = obj.defaultValue ?? ''

      entries.push({
        index: obj.index,
        subIndex: 0,
        value: defaultValue,
        defaultValue,
        dataType: obj.type,
        bitLength: obj.bitSize,
        name: obj.name,
        objectName: obj.name,
      })
    }
  }

  return entries
}
