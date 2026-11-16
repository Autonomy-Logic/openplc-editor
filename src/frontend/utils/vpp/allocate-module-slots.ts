import type { IoMappingEntry } from '@root/middleware/shared/ports/types'
import { type AddressPool, nextFreeAddress } from '@root/middleware/shared/utils/iec-address'

import { isResolverAddressMapping, resolveModuleChannels, type SlotFieldValue } from './resolve-module-channels'

export interface AllocatableModule {
  id: string
  name: string
  addressMapping?: unknown
}

export interface DroppedAlias {
  alias: string
  slot: number
  channelName: string
}

export interface ModuleSlotsInput {
  /** Manifest module id per slot, slot 1 first; `null` is an empty slot. */
  slots: ReadonlyArray<string | null>
  /** Per-slot field values keyed by the 1-based slot number. */
  slotsConfig: Readonly<Record<string, Readonly<Record<string, SlotFieldValue>>>>
  modules: readonly AllocatableModule[]
  pool: AddressPool
  previous: readonly IoMappingEntry[]
}

export interface ModuleSlotsAllocation {
  entries: IoMappingEntry[]
  /** Aliases of `previous` that no entry kept. */
  dropped: DroppedAlias[]
}

const channelKey = (slot: number, channelName: string): string => `${slot}:${channelName}`

/**
 * One I/O mapping entry per manifest channel of every occupied slot, with a
 * provisional address. An alias is kept while the same slot holds the same
 * module id; `recalculateIecAddresses` owns the final addresses.
 */
export function allocateModuleSlots({
  slots,
  slotsConfig,
  modules,
  pool,
  previous,
}: ModuleSlotsInput): ModuleSlotsAllocation {
  const previousAliases = new Map<string, { alias: string; moduleId: string; slot: number; channelName: string }>()
  for (const entry of previous) {
    if (entry.alias) {
      previousAliases.set(channelKey(entry.slot, entry.channelName), {
        alias: entry.alias,
        moduleId: entry.moduleId,
        slot: entry.slot,
        channelName: entry.channelName,
      })
    }
  }
  // An entry without a module id predates that field; it keeps its alias as before.
  const aliasFor = (key: string, moduleId: string): string => {
    const existing = previousAliases.get(key)
    if (!existing) return ''
    return !existing.moduleId || existing.moduleId === moduleId ? existing.alias : ''
  }

  const inFlight = new Set<string>()
  const entries: IoMappingEntry[] = []
  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    const moduleId = slots[slotIndex]
    if (!moduleId) continue
    const moduleDef = modules.find((m) => m.id === moduleId)
    if (!moduleDef) continue
    const addressMapping = isResolverAddressMapping(moduleDef.addressMapping) ? moduleDef.addressMapping : undefined
    const slot = slotIndex + 1
    const channels = resolveModuleChannels({ addressMapping }, slotsConfig[String(slot)] ?? {})

    for (const channel of channels) {
      const isBit = channel.addressPrefix === '%IX' || channel.addressPrefix === '%QX'
      const iecAddress = nextFreeAddress(pool, channel.addressPrefix, isBit, undefined, inFlight)
      inFlight.add(iecAddress)
      entries.push({
        slot,
        moduleId,
        moduleName: moduleDef.name,
        channelName: channel.name,
        channelType: channel.type,
        dataType: channel.dataType,
        iecAddress,
        alias: aliasFor(channelKey(slot, channel.name), moduleId),
        modeFieldId: channel.modeFieldId,
        modeOptions: channel.modeOptions,
        modeValue: channel.modeValue,
      })
    }
  }

  const kept = new Set(entries.filter((entry) => entry.alias).map((entry) => channelKey(entry.slot, entry.channelName)))
  const dropped: DroppedAlias[] = []
  for (const [key, prior] of previousAliases) {
    if (!kept.has(key)) dropped.push({ alias: prior.alias, slot: prior.slot, channelName: prior.channelName })
  }
  return { entries, dropped }
}
