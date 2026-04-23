/**
 * IEC 61131-3 address generation utility.
 *
 * `collectUsedIecAddresses` — the companion "which addresses are already
 * claimed" scanner — lives at `@root/backend/shared/utils/iec-address`
 * because it needs to be callable from both the frontend store and the
 * backend compile pipeline.
 */

/**
 * Generate the next available IEC address for a given prefix, skipping
 * anything already in `usedAddresses`.
 *
 * @param prefix         Address prefix (e.g., '%IX', '%QX', '%IW', '%QW')
 * @param isBit          true for bit addressing (`prefix + byte.bit`);
 *                       false for word addressing (`prefix + index`)
 * @param usedAddresses  set of already-claimed addresses to skip over
 * @param startFrom      optional starting offset (default 0)
 */
export function generateIecAddress(
  prefix: string,
  isBit: boolean,
  usedAddresses: Set<string>,
  startFrom?: number,
): string {
  let current = startFrom ?? 0

  while (true) {
    const addr = isBit ? `${prefix}${Math.floor(current / 8)}.${current % 8}` : `${prefix}${current}`
    if (!usedAddresses.has(addr)) return addr
    current++
  }
}
