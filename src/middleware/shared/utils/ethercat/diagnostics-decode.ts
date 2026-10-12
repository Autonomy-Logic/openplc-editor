/**
 * Shared decoders for modular-coupler diagnostics.  Translate the raw bit flags and
 * module status bytes the runtime returns into user-facing warnings.  Both editor and
 * web render the same banners, so the mapping lives here.
 *
 * Interpretation follows ETG.5001:
 *   - Device-state bit 6: configuration mismatch — the physical bus is different from
 *     the project's configured module list.
 *   - Device-state bit 7: configuration never written — `0xF030` has not been issued yet.
 *   - Per-module status byte: 0x00 operational, 0x81 wrong module, 0x82 no module,
 *     0x83 configuration mismatch for the slot, others vendor-specific.
 */

export interface DecodedCouplerStatus {
  configurationMismatch: boolean
  neverWritten: boolean
}

export function decodeCouplerStatus(statusWord: number): DecodedCouplerStatus {
  return {
    configurationMismatch: (statusWord & 0x40) !== 0,
    neverWritten: (statusWord & 0x80) !== 0,
  }
}

export interface DecodedModuleStatus {
  /** True when the status byte reports an operational module (0x00). */
  operational: boolean
  /** Plain-language description. */
  message: string
}

const MODULE_STATUS_MESSAGES: Record<number, string> = {
  0x00: 'Operational',
  0x81: 'Wrong module plugged in',
  0x82: 'No module in this slot',
  0x83: 'Configuration mismatch for this slot',
}

export function decodeModuleStatus(statusByte: number): DecodedModuleStatus {
  const message = MODULE_STATUS_MESSAGES[statusByte]
  if (message !== undefined) {
    return { operational: statusByte === 0x00, message }
  }
  const hex = statusByte.toString(16).padStart(2, '0').toUpperCase()
  return { operational: false, message: `Vendor-specific status 0x${hex}` }
}
