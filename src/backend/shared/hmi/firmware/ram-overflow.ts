/**
 * Reads a failed firmware build's compiler output for a static RAM overflow, so a build with HMI screens can say the
 * HMI does not fit instead of showing the linker's message alone.
 */

/** Bytes a data region overflowed by, from GNU ld; code and flash regions are left out. */
const REGION_OVERFLOW = /region [`'"]?([\w.]+)['"]? overflowed by (\d+) bytes?/g
/** A data section the linker could not place, with or without a byte count. */
const SECTION_NOT_FIT = /section [`'"]?\.[\w.]*(?:bss|data)[\w.]*['"]? will not fit in region/i
/** arduino-cli's size check: "Global variables use N bytes ... Maximum is M bytes." */
const GLOBALS_USE = /Global variables use (\d+) bytes.*?Maximum is (\d+) bytes/i
const NOT_ENOUGH_MEMORY = /Not enough memory|data section exceeds available space/i
const CODE_REGION = /iram|irom|flash|rom|text|code/i

/** Whether a linker region holds data (RAM) rather than code. */
const isDataRegion = (name: string): boolean => !CODE_REGION.test(name)

/** Bytes the build's static RAM is over, null when the output shows no RAM overflow; 0 when the amount is unknown. */
export function staticRamOverflowBytes(output: string): number | null {
  let worst: number | null = null
  for (const match of output.matchAll(REGION_OVERFLOW)) {
    if (!isDataRegion(match[1])) continue
    const bytes = Number(match[2])
    if (worst === null || bytes > worst) worst = bytes
  }
  if (worst !== null) return worst
  if (NOT_ENOUGH_MEMORY.test(output)) {
    const sizes = GLOBALS_USE.exec(output.replace(/\r?\n/g, ' '))
    if (sizes) {
      const over = Number(sizes[1]) - Number(sizes[2])
      return over > 0 ? over : 0
    }
    return 0
  }
  return SECTION_NOT_FIT.test(output) ? 0 : null
}

/** What to tell the user when a build with HMI screens ran out of static RAM; null when the output shows no overflow. */
export function hmiRamOverflowMessage(output: string): string | null {
  const over = staticRamOverflowBytes(output)
  if (over === null) return null
  const amount = over > 0 ? ` (${over} bytes over)` : ''
  return `The HMI does not fit in this board's RAM${amount}. Use fewer or simpler screens, or a board with more memory.`
}
