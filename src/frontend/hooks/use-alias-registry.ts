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
import type { DevicePin, PLCRemoteDevice } from '@root/middleware/shared/ports/types'
import type { AliasRegistry } from '@root/middleware/shared/utils/iec-address'
import { buildAddressPool, buildAliasRegistry } from '@root/middleware/shared/utils/iec-address'
import type { TargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'

import { useTargetCapabilities } from './use-target-capabilities'

interface RegistryCache {
  pins: DevicePin[]
  vsd: Record<string, unknown> | undefined
  remoteDevices: PLCRemoteDevice[] | undefined
  capabilities: TargetCapabilities
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
  const capabilities = useTargetCapabilities()

  if (
    cache &&
    cache.pins === pins &&
    cache.vsd === vsd &&
    cache.remoteDevices === remoteDevices &&
    cache.capabilities === capabilities
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
    capabilities,
  )
  const registry = buildAliasRegistry(pool)

  cache = { pins, vsd, remoteDevices, capabilities, registry }
  return registry
}
