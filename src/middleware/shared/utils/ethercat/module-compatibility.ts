/**
 * Whether a module from the ESI repository can be plugged into a given modular coupler: same
 * vendor, and accepted by one of the coupler's `<Slot>` definitions (by ident or class). Used by
 * the module browser (filters the list) and by the scan-apply path (an incompatible scanned
 * ident is shown as unmatched).
 */

import type { ESIModuleSummary, ESIRepositoryItemLight, ESISlotsSpec } from '../../ports/esi-types'
import { couplerAcceptsModule } from './module-station'

export interface CouplerCompatibility {
  vendorId: string
  /** The coupler's `<Slots>` block; without it only the vendor is checked. */
  slots?: ESISlotsSpec
}

/**
 * A vendor id as `0x` + 8 upper-case hex digits, whatever notation it came in (`#x230`,
 * `0x00000230`, decimal `560`). Unparseable input is returned trimmed.
 */
export function canonicalVendorId(raw: string): string {
  const text = raw.trim()
  const hex = /^(?:0x|#x)([0-9a-f]+)$/i.exec(text)?.[1]
  const value = hex !== undefined ? Number.parseInt(hex, 16) : /^\d+$/.test(text) ? Number(text) : Number.NaN
  if (!Number.isSafeInteger(value)) return text
  return `0x${value.toString(16).toUpperCase().padStart(8, '0')}`
}

export function isModuleCompatibleWithCoupler(
  repoItem: Pick<ESIRepositoryItemLight, 'vendor'>,
  module: Pick<ESIModuleSummary, 'ident' | 'moduleClass'>,
  coupler: CouplerCompatibility,
): boolean {
  if (canonicalVendorId(repoItem.vendor.id) !== canonicalVendorId(coupler.vendorId)) return false
  return couplerAcceptsModule(coupler.slots, module)
}
