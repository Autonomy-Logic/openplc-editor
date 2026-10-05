import type { RtosSettings } from './types'

/** The `vendorScreenData` section RTOS mode keeps its per-board choice in. */
export const RTOS_SETTINGS_SECTION = 'rtos'

/**
 * Whether a supported board builds in RTOS mode when the user never touched
 * the switch: on, with the Board Settings switch as the way back to the single
 * loop.
 */
export const RTOS_DEFAULT_ENABLED = true

/**
 * The user's RTOS choice for the board whose screen data this is.
 *
 * Kept in `vendorScreenData` so it is per board for free: switching boards
 * swaps the whole section, and an editor that predates RTOS mode round-trips
 * the section untouched. Only an explicit boolean counts; anything else is the
 * default.
 */
export function readRtosSettings(vendorScreenData: Record<string, unknown> | undefined): RtosSettings {
  const section = vendorScreenData?.[RTOS_SETTINGS_SECTION]
  const enabled = typeof section === 'object' && section !== null && 'enabled' in section ? section.enabled : undefined
  return typeof enabled === 'boolean' ? { enabled, chosen: true } : { enabled: RTOS_DEFAULT_ENABLED, chosen: false }
}
