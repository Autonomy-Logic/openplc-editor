/**
 * Selector hook that resolves the active target's `TargetCapabilities`
 * from the live store state — the same resolution path
 * `useAliasRegistry` runs to scope the address pool, exposed as a
 * standalone hook so UI surfaces that gate their content on the active
 * target (location-cell dropdown, board picker, debugger selector)
 * share one canonical answer.
 *
 * Backed by a module-level single-entry cache keyed on the
 * `(deviceBoard, availableBoards)` pair so dozens of cells calling
 * this in the same render-pass share one resolution. Zustand
 * guarantees referential stability on unchanged state so the cache
 * hit is the steady-state path.
 */

import { useOpenPLCStore } from '@root/frontend/store'
import type { BoardInfo } from '@root/middleware/shared/ports/types'
import { resolveTargetCapabilities, type TargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

interface CapabilitiesCache {
  deviceBoard: string
  availableBoards: Map<string, BoardInfo>
  capabilities: TargetCapabilities
}

let cache: CapabilitiesCache | null = null

export function useTargetCapabilities(): TargetCapabilities {
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)

  if (cache && cache.deviceBoard === deviceBoard && cache.availableBoards === availableBoards) {
    return cache.capabilities
  }

  const capabilities = resolveTargetCapabilities(availableBoards.get(deviceBoard))
  cache = { deviceBoard, availableBoards, capabilities }
  return capabilities
}
