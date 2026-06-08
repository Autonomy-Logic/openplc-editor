import type { AvailableBoards } from './types'

// The `AvailableBoards` Map's value shape is declared inline in
// `types.ts` (the legacy `BoardInfo` export refers to the hals.json
// schema, not the runtime/UI board info). Derive the correct value type
// from the Map itself so future schema drift in `AvailableBoards`
// propagates here automatically.
type AvailableBoardInfo = AvailableBoards extends Map<string, infer V> ? V : never

/**
 * Reorder the boards Map so the device dropdown groups entries by their
 * source VPP package instead of intermixing them alphabetically across
 * every installed package.
 *
 * Order:
 *
 *   1. Built-in targets (anything without a `vpp` field — `hals.json`
 *      retains `OpenPLC Runtime v3`, `OpenPLC Runtime v4`, and
 *      `OpenPLC Simulator` after the Arduino-to-VPP migration). Sorted
 *      by name alphabetically; the natural alphabetical order also
 *      happens to be the chronological order users expect (Runtime v3
 *      → Runtime v4 → Simulator).
 *
 *   2. VPP-sourced devices, partitioned by `info.vpp.packageId`,
 *      VPP groups sorted alphabetically by package id, devices within
 *      each group sorted alphabetically by display name. Side effect:
 *      every device from `com.openplc.arduino` lands contiguously, then
 *      every device from `com.openplc.arduino-industrial`, etc.
 *
 * Pure function — relies on `Map` insertion-order preservation. Caller
 * is expected to feed the merged result of `hals.json` + every
 * `#mergeVppBoards` pass. Defensive against:
 *
 *   - Empty input (returns an empty Map without iterating).
 *   - VPP entries with falsy `packageId` (treated as built-in so a
 *     malformed manifest can't bury an entry off-list).
 */
export function orderBoardsByVppGroup(boards: AvailableBoards): AvailableBoards {
  const builtIns: Array<[string, AvailableBoardInfo]> = []
  const vppGroups = new Map<string, Array<[string, AvailableBoardInfo]>>()

  for (const [name, info] of boards.entries()) {
    const packageId = info.vpp?.packageId
    if (packageId) {
      const group = vppGroups.get(packageId) ?? []
      group.push([name, info])
      vppGroups.set(packageId, group)
    } else {
      builtIns.push([name, info])
    }
  }

  builtIns.sort(([a], [b]) => a.localeCompare(b))
  for (const group of vppGroups.values()) {
    group.sort(([a], [b]) => a.localeCompare(b))
  }
  const sortedGroupKeys = [...vppGroups.keys()].sort((a, b) => a.localeCompare(b))

  const ordered: AvailableBoards = new Map()
  for (const [name, info] of builtIns) ordered.set(name, info)
  for (const key of sortedGroupKeys) {
    const group = vppGroups.get(key)
    if (!group) continue
    for (const [name, info] of group) ordered.set(name, info)
  }
  return ordered
}
