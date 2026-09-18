import type { PLCPou } from '../../middleware/shared/ports/types'

/**
 * A project that failed to parse opens with `pous: []`
 * (`store/slices/shared/slice.ts`), so this doubles as the fatal-error gate
 * without threading a separate flag through. `canEdit` is deliberately not
 * checked — read-only viewers can still export (BR02).
 */
export function canExportPdf(pous: PLCPou[]): boolean {
  return pous.length > 0
}
