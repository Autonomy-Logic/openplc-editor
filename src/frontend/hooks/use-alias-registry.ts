/**
 * Selector hook that derives the alias registry from the live store
 * state. Backed by a module-level single-entry cache so callers in
 * the same render-pass share a single registry build — important
 * because every variable cell calls this hook and the variable table
 * can have dozens of rows.
 *
 * For backend / non-React contexts use `buildAliasRegistry` directly
 * with a pool you built yourself; this hook only handles the
 * store-driven plumbing the renderer needs.
 */

import { useOpenPLCStore } from '@root/frontend/store'
import type { BoardInfo, DevicePin, PLCRemoteDevice } from '@root/middleware/shared/ports/types'
import type { AliasRegistry } from '@root/middleware/shared/utils/iec-address'
import { buildAddressPool, buildAliasRegistry } from '@root/middleware/shared/utils/iec-address'
import { resolveAddressProducerCapabilities } from '@root/middleware/shared/utils/target-capabilities'

interface RegistryCache {
  pins: DevicePin[]
  vsd: Record<string, unknown> | undefined
  remoteDevices: PLCRemoteDevice[] | undefined
  boardInfo: BoardInfo | undefined
  registry: AliasRegistry
}

// Module-level cache: every cell consuming the registry in the same
// render pass hits this. When any input's identity changes (Zustand
// guarantees identity stability when nothing changed), the next call
// rebuilds and replaces the cache. Single-entry is enough because the
// inputs together identify a single canonical registry — there's
// nothing to keep around from prior states.
let cache: RegistryCache | null = null

export function useAliasRegistry(): AliasRegistry {
  // The pin-mapping dict is keyed by board id (see DevicePinMapping).
  // The active board's bucket is what the alias registry should see —
  // pins for any non-active board are persisted on disk but don't
  // contribute claims to the address pool.
  const pinsByBoard = useOpenPLCStore((s) => s.deviceDefinitions.pinMapping.pinsByBoard)
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const pins = pinsByBoard[deviceBoard] ?? []
  const vsd = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const remoteDevices = useOpenPLCStore((s) => s.project.data.remoteDevices)
  // NOT `useTargetCapabilities`, which answers "no producers at all" for a
  // board that does not resolve — the VPP package is not installed, the
  // project came from another machine, or the catalogue has not loaded yet.
  // That answer is right for gating a UI element and wrong for scoping a
  // pool: an empty pool makes every claimed address look free, so the alias
  // registry stops seeing the conflicts it exists to report (DOPE-615, C1).
  //
  // Cached on the BOARD INFO rather than on the resolved block, because the
  // resolver spreads a board's own capability object and so returns a fresh
  // reference every call. Comparing that would miss the cache on every render
  // and rebuild the registry for every cell consuming it.
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)
  const boardInfo = availableBoards.get(deviceBoard)

  if (
    cache &&
    cache.pins === pins &&
    cache.vsd === vsd &&
    cache.remoteDevices === remoteDevices &&
    cache.boardInfo === boardInfo
  ) {
    return cache.registry
  }

  const ioMapping =
    (
      vsd?.['io-mapping'] as
        | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
        | undefined
    )?.entries ?? []
  const pool = buildAddressPool(
    {
      pinMapping: { pins },
      vendorIoMapping: { entries: ioMapping },
      remoteDevices,
    },
    resolveAddressProducerCapabilities(boardInfo),
  )
  const registry = buildAliasRegistry(pool)

  cache = { pins, vsd, remoteDevices, boardInfo, registry }
  return registry
}
