/**
 * Selector hook that derives the alias registry from the live store
 * state. Returns a fresh registry on every render so callers see
 * up-to-date alias mappings — but cheap to recompute (O(producers))
 * and only consulted in places that actually need it (variable cell
 * orphan badge, alias-edit uniqueness check).
 *
 * For backend / non-React contexts use `buildAliasRegistry` directly
 * with a pool you built yourself; this hook only handles the
 * store-driven plumbing the renderer needs.
 */

import type { AliasRegistry } from '@root/backend/shared/utils/iec-address'
import { buildAddressPool, buildAliasRegistry } from '@root/backend/shared/utils/iec-address'
import { resolveTargetCapabilities } from '@root/backend/shared/utils/target-capabilities'
import { useOpenPLCStore } from '@root/frontend/store'
import { useMemo } from 'react'

export function useAliasRegistry(): AliasRegistry {
  // Subscribe to each input separately so we only re-derive when one
  // of them actually changes (Zustand bails out on Object.is identity).
  const pins = useOpenPLCStore((s) => s.deviceDefinitions.pinMapping.pins)
  const vsd = useOpenPLCStore((s) => s.deviceDefinitions.configuration.vendorScreenData)
  const remoteDevices = useOpenPLCStore((s) => s.project.data.remoteDevices)
  const deviceBoard = useOpenPLCStore((s) => s.deviceDefinitions.configuration.deviceBoard)
  const availableBoards = useOpenPLCStore((s) => s.deviceAvailableOptions.availableBoards)

  return useMemo(() => {
    const boardInfo = availableBoards.get(deviceBoard)
    const ioMapping =
      (vsd?.['io-mapping'] as
        | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
        | undefined)?.entries ?? []
    const pool = buildAddressPool(
      {
        pinMapping: { pins },
        vendorIoMapping: { entries: ioMapping },
        remoteDevices,
      },
      resolveTargetCapabilities(boardInfo),
    )
    return buildAliasRegistry(pool)
  }, [pins, vsd, remoteDevices, deviceBoard, availableBoards])
}
