import type { ESIDeviceSummary } from '@root/middleware/shared/ports/esi-types'

type ShortNameInput = Pick<ESIDeviceSummary, 'name' | 'type'>

// SKU-shaped tokens: leading letter, ≥1 digit, only [A-Z0-9_-].
// Rejects descriptive tokens that happen to contain a digit
// (e.g. "2-Channel", "24V", "2Ch."), which are common when a vendor
// puts the model code *after* the description in <Name LcId="1033">.
const SKU_TOKEN = /^[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*$/i

/**
 * Pick a short, human-readable device name from an ESI device summary.
 *
 * The ESI schema doesn't require <Type> to carry text content (only the
 * ProductCode/RevisionNo attributes), so vendors that emit a self-closing
 * <Type/> leave us without a short code. This walks a fallback chain so
 * the UI always renders something sensible, and worst-case falls back to
 * the canonical (ProductCode, RevisionNo) identity that is unique by
 * construction.
 */
export function getShortDeviceName(esiDevice: ShortNameInput): string {
  const typeText = esiDevice.type.name.trim()
  const longName = esiDevice.name.trim()

  // P1: <Type> text if it already looks like a short code.
  if (typeText && typeText.length <= 24 && !/\s/.test(typeText)) {
    return typeText
  }

  // P2: first token of <Name> if it matches an SKU shape.
  if (longName) {
    const firstToken = longName.split(/[\s,;]/)[0]
    if (firstToken.length >= 3 && firstToken.length <= 24 && SKU_TOKEN.test(firstToken)) {
      return firstToken
    }
  }

  // P3: <Type> text even if it's longer than a typical SKU.
  if (typeText) return typeText

  // P4: full long name as-is.
  if (longName) return longName

  // P5: canonical ETG identity — always unique, always deterministic.
  return `Device_${esiDevice.type.productCode}_${esiDevice.type.revisionNo}`
}
