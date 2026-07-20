/**
 * Pure registry operations. Every mutator returns a NEW registry (no
 * in-place mutation) with `assignments` recomputed, so the Zustand slice
 * can wrap these 1:1 and callers always see a coherent, gapless result.
 */

import { allocateAddresses, channelKey } from './allocate'
import type {
  AddressConflict,
  AllocateOptions,
  IecAddressRegistry,
  RegistryChannel,
  RegistryConsumer,
  SetAliasResult,
} from './types'

export function createRegistry(): IecAddressRegistry {
  return { consumers: [], assignments: {} }
}

/**
 * Restore aliases from the session alias-memory onto channels that carry a
 * `memoryKey` but currently have no alias. This is what brings a module's
 * aliases back when it is removed and re-added on the same slot within a
 * session — the memory (keyed by `moduleId:slot:channel`) survives the
 * channel's absence. Channels that already have an alias, or lack a
 * `memoryKey`, are left untouched. Pure; the memory itself lives in the
 * store (session-scoped, never serialized).
 */
export function restoreAliasesFromMemory(
  registry: IecAddressRegistry,
  memory: Readonly<Record<string, string>>,
): IecAddressRegistry {
  const consumers = registry.consumers.map((consumer) => ({
    ...consumer,
    channels: consumer.channels.map((channel) => {
      if (channel.alias || !channel.memoryKey) return channel
      const remembered = memory[channel.memoryKey]
      return remembered ? { ...channel, alias: remembered } : channel
    }),
  }))
  return { ...registry, consumers }
}

/** Reassign every address from the registered consumers. Deterministic,
 *  gapless, and idempotent (recalculating an unchanged registry is a
 *  no-op). Pass `options.activeKinds` to scope allocation to the current
 *  target's capabilities. Returns the new registry plus any pinned-address
 *  conflicts. */
export function recalculate(
  registry: IecAddressRegistry,
  options: AllocateOptions = {},
): {
  registry: IecAddressRegistry
  conflicts: AddressConflict[]
} {
  const { assignments, conflicts } = allocateAddresses(registry.consumers, options)
  return { registry: { consumers: registry.consumers, assignments }, conflicts }
}

/** Register a new consumer (or replace one with the same id) and recompute. */
export function addConsumer(
  registry: IecAddressRegistry,
  consumer: RegistryConsumer,
  options: AllocateOptions = {},
): IecAddressRegistry {
  const consumers = registry.consumers.filter((c) => c.id !== consumer.id)
  consumers.push(consumer)
  return recalculate({ ...registry, consumers }, options).registry
}

/** Remove a consumer by id and recompute so survivors reclaim its slots. */
export function removeConsumer(
  registry: IecAddressRegistry,
  consumerId: string,
  options: AllocateOptions = {},
): IecAddressRegistry {
  const consumers = registry.consumers.filter((c) => c.id !== consumerId)
  return recalculate({ ...registry, consumers }, options).registry
}

/** Patch a consumer's channels / label / order and recompute. No-op when
 *  the consumer is unknown. */
export function updateConsumer(
  registry: IecAddressRegistry,
  consumerId: string,
  patch: Partial<Pick<RegistryConsumer, 'channels' | 'label' | 'order'>>,
  options: AllocateOptions = {},
): IecAddressRegistry {
  let found = false
  const consumers = registry.consumers.map((c) => {
    if (c.id !== consumerId) return c
    found = true
    return { ...c, ...patch }
  })
  if (!found) return registry
  return recalculate({ ...registry, consumers }, options).registry
}

/** The resolved address for a channel, or `undefined` when unknown. */
export function addressOf(registry: IecAddressRegistry, consumerId: string, channelId: string): string | undefined {
  return registry.assignments[channelKey(consumerId, channelId)]
}

/** Find a channel (and its owning consumer) by ids. */
function findChannel(
  registry: IecAddressRegistry,
  consumerId: string,
  channelId: string,
): { consumer: RegistryConsumer; channel: RegistryChannel } | undefined {
  const consumer = registry.consumers.find((c) => c.id === consumerId)
  if (!consumer) return undefined
  const channel = consumer.channels.find((ch) => ch.channelId === channelId)
  if (!channel) return undefined
  return { consumer, channel }
}

/**
 * Set (or clear) a channel's alias, enforcing system-wide uniqueness — this
 * is the ONE place aliases are validated. An empty / whitespace-only alias
 * clears it. Assignments are unaffected (an alias does not change
 * allocation), so no recompute is needed.
 */
export function setAlias(
  registry: IecAddressRegistry,
  consumerId: string,
  channelId: string,
  alias: string,
): SetAliasResult {
  const target = findChannel(registry, consumerId, channelId)
  if (!target) return { ok: true, registry }

  const trimmed = alias.trim()

  if (trimmed.length > 0) {
    for (const consumer of registry.consumers) {
      for (const channel of consumer.channels) {
        if (consumer.id === consumerId && channel.channelId === channelId) continue
        if (channel.alias === trimmed) {
          return { ok: false, conflict: { alias: trimmed, consumerId: consumer.id, channelId: channel.channelId } }
        }
      }
    }
  }

  const consumers = registry.consumers.map((c) => {
    if (c.id !== consumerId) return c
    return {
      ...c,
      channels: c.channels.map((ch) =>
        ch.channelId === channelId ? { ...ch, alias: trimmed.length > 0 ? trimmed : undefined } : ch,
      ),
    }
  })
  return { ok: true, registry: { ...registry, consumers } }
}
