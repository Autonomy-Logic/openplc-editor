/**
 * SDO Configuration Defaults Extraction
 *
 * Extracts configurable SDO parameters from CoE Object Dictionary entries.
 * Filters to only include user-configurable (RW) parameters in the
 * manufacturer-specific and profile-specific ranges, excluding objects that
 * are mapped to PDOs (those are streamed cyclically, not configured at startup).
 *
 * ESI <DefaultData> contains hex-encoded little-endian wire bytes.  This module
 * decodes them into type-aware display strings (decimal for integers, 0xNN
 * for bitmask types, TRUE/FALSE for BOOL, etc.) so the UI shows operator-
 * friendly values instead of raw hex blobs.
 */

import type { ESICoEObject, SDOConfigurationEntry } from '@root/middleware/shared/ports/esi-types'

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
 * Decode an ESI <DefaultData> hex string into a type-aware display value.
 *
 * <DefaultData> is hex-encoded little-endian wire bytes per ETG.2000.
 * Examples (UINT16):
 *   "0100"  -> 1
 *   "E803"  -> 1000
 *   "0080"  -> -32768  (when interpreted as INT16)
 *
 * Display conventions follow what TwinCAT/CODESYS show by default:
 *   - BOOL                       -> "TRUE" / "FALSE"
 *   - BYTE / WORD / DWORD / LWORD -> "0xNN" (bitmask types are read as hex)
 *   - SINT/INT/DINT/LINT          -> signed decimal
 *   - USINT/UINT/UDINT/ULINT      -> unsigned decimal
 *   - REAL / LREAL                -> decimal (DataView IEEE-754 LE)
 *
 * Unknown types or invalid input fall through to the raw hex string so
 * the operator at least sees what came from the ESI rather than nothing.
 */
function decodeEsiDefaultData(hex: string | undefined, dataType: string | undefined, bitSize: number): string {
  if (!hex) return ''
  const clean = hex.replace(/\s+/g, '').replace(/^0x/i, '')
  if (clean.length === 0) return ''
  // Defensive: pad to even length so each byte parses cleanly
  const padded = clean.length % 2 === 0 ? clean : '0' + clean
  if (!/^[0-9a-fA-F]+$/.test(padded)) return hex

  const bytes: number[] = []
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.substring(i, i + 2), 16))
  }

  const dt = (dataType ?? '').toUpperCase()

  if (dt === 'BOOL') {
    return bytes[0] !== 0 ? 'TRUE' : 'FALSE'
  }

  // Bitmask types: print as 0x... padded to the declared width.
  if (dt === 'BYTE' || dt === 'WORD' || dt === 'DWORD' || dt === 'LWORD') {
    const msbFirst = [...bytes].reverse()
    const hexStr = msbFirst
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
    const expectedDigits = Math.max(1, Math.ceil(bitSize / 4))
    return '0x' + hexStr.padStart(expectedDigits, '0')
  }

  if (dt === 'REAL') {
    if (bytes.length < 4) return hex
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    for (let i = 0; i < 4; i++) view.setUint8(i, bytes[i] ?? 0)
    return view.getFloat32(0, true).toString()
  }
  if (dt === 'LREAL') {
    if (bytes.length < 8) return hex
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    for (let i = 0; i < 8; i++) view.setUint8(i, bytes[i] ?? 0)
    return view.getFloat64(0, true).toString()
  }

  // Integer path -- BigInt avoids precision loss on 64-bit unsigned types.
  let val = 0n
  for (let i = bytes.length - 1; i >= 0; i--) {
    val = (val << 8n) | BigInt(bytes[i])
  }

  const isSigned = dt === 'SINT' || dt === 'INT' || dt === 'DINT' || dt === 'LINT'
  if (isSigned && bitSize > 0) {
    const signBit = 1n << BigInt(bitSize - 1)
    if (val & signBit) {
      val = val - (1n << BigInt(bitSize))
    }
  }

  return val.toString()
}

/**
 * Extract default SDO configurations from CoE Object Dictionary.
 *
 * Returns one SDOConfigurationEntry per RW parameter found in the
 * configurable ranges (0x2000+) that is NOT mapped to a PDO.  PDO-mapped
 * objects (0x6000-0x6FFF inputs, 0x7000-0x7FFF outputs) are excluded here
 * because their values are driven cyclically by the master, not configured
 * via SDO at startup.  For complex objects, each RW sub-item (except
 * subIndex 0 which is the max-subindex counter) gets its own entry, with
 * its <DefaultData> decoded from LE wire bytes into a display value.
 */
export function extractDefaultSdoConfigurations(coeObjects: ESICoEObject[]): SDOConfigurationEntry[] {
  const entries: SDOConfigurationEntry[] = []

  for (const obj of coeObjects) {
    if (!isConfigurableRange(obj.index)) continue
    // PDO-mapped objects are streamed cyclically, not configured via SDO.
    if (obj.pdoMapping) continue

    if (obj.subItems && obj.subItems.length > 0) {
      for (const sub of obj.subItems) {
        const subIdx = parseInt(sub.subIndex, 10)
        if (subIdx === 0) continue
        if (sub.access !== 'RW') continue

        // Vendor may omit <DefaultValue>/<DefaultData> on RW entries that
        // require explicit operator input (motor torque limits, IDs, etc).
        // Surface them with an empty default so they are visible and
        // configurable in the UI; the exporter skips entries the operator
        // never fills in.
        const decoded = decodeEsiDefaultData(sub.defaultValue, sub.type, sub.bitSize)
        entries.push({
          index: obj.index,
          subIndex: subIdx,
          value: decoded,
          defaultValue: decoded,
          dataType: sub.type,
          bitLength: sub.bitSize,
          name: sub.name,
          objectName: obj.name,
        })
      }
    } else {
      if (obj.access !== 'RW') continue

      const decoded = decodeEsiDefaultData(obj.defaultValue, obj.type, obj.bitSize)
      entries.push({
        index: obj.index,
        subIndex: 0,
        value: decoded,
        defaultValue: decoded,
        dataType: obj.type,
        bitLength: obj.bitSize,
        name: obj.name,
        objectName: obj.name,
      })
    }
  }

  return entries
}
