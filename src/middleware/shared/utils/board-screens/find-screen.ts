/** Canonical name of the serial screen a baremetal VPP ships. */
export const BOARD_SERIAL_SCREEN = 'serial'

/** Canonical name of the network screen a baremetal VPP ships. */
export const BOARD_NETWORK_SCREEN = 'network'

/**
 * Find a VPP screen by its canonical name, case-insensitively, and return the
 * name the package keys it under (`"Serial"`, `"Network"`).
 */
export function findBoardScreen(screens: Record<string, unknown> | undefined, canonical: string): string | undefined {
  if (!screens) return undefined
  return Object.keys(screens).find((name) => name.toLowerCase() === canonical)
}
