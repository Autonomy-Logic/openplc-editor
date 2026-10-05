/**
 * RTOS mode on the active board: the RTOS it builds against, and whether the
 * user chose it. Undefined when the board has no RTOS or its switch is off. The
 * build reaches the same answer from the same inputs.
 */

import { useOpenPLCStore } from '@root/frontend/store'
import { readRtosSettings, type RtosTargetProfile } from '@root/middleware/shared/utils/rtos'

import { useTargetCapabilities } from './use-target-capabilities'

export interface ActiveRtosMode {
  profile: RtosTargetProfile
  /** Set by the user rather than left at the default: a build RTOS mode cannot
   *  make then fails, where on the default it builds the single loop. */
  chosen: boolean
}

export function useRtosMode(): ActiveRtosMode | undefined {
  const { rtos } = useTargetCapabilities()
  const vendorScreenData = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  if (!rtos) return undefined
  const settings = readRtosSettings(vendorScreenData)
  return settings.enabled ? { profile: rtos, chosen: settings.chosen } : undefined
}
