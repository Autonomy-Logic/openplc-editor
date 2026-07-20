/**
 * Migrate a legacy project's scattered producer addresses into the central
 * registry (see docs/iec-address-registry.md §7).
 *
 * The transform reuses the loosely-typed `PoolInputs` shapes the old
 * address pool already consumed — pins, VPP `io-mapping` entries, Modbus
 * `ioPoints`, EtherCAT `channelMappings` — so it stays decoupled from the
 * full project schema.
 *
 * Each channel is seeded with `pinned = its current legacy address`, so the
 * first `recalculate` reproduces exactly today's addresses (nothing moves on
 * open). The store then:
 *   1. adopts program variables onto the aliases at these legacy addresses,
 *   2. calls `unpinAllocatableChannels` to release the seeds on everything
 *      except real hardware pins, and
 *   3. recalculates (capability-scoped), after which allocatable producers
 *      compact and alias-bound variables follow their moved addresses.
 */

import type { PoolInputs } from '../address-pool'
import { parseAddress } from './address-space'
import { recalculate } from './registry'
import type {
  AddressClass,
  AddressConflict,
  AllocateOptions,
  IecAddressRegistry,
  RegistryChannel,
  RegistryConsumer,
} from './types'

const PIN_MAPPING_KIND = 'pin-mapping'

/* Consumer-id builders. Exported so the store's address write-back keys the
 * registry the exact same way the migration created it (no drift). */
export const modbusConsumerId = (deviceName: string, groupId: string): string => `modbus:${deviceName}:${groupId}`
export const ethercatConsumerId = (deviceName: string, slaveName: string): string =>
  `ethercat:${deviceName}:${slaveName}`

/* Session alias-memory key builders. The key is the stable *semantic*
 * identity of a channel — it must be identical at the migration site and at
 * every alias-edit site so `restoreAliasesFromMemory` matches. Exported so
 * producers (e.g. the VPP layouts) record aliases under the same key. */
export const vppMemoryKey = (moduleId: string, slot: number, channelName: string): string =>
  `vpp:${moduleId}:${slot}:${channelName}`
export const modbusMemoryKey = (deviceName: string, groupId: string, pointId: string): string =>
  `modbus:${deviceName}:${groupId}:${pointId}`
export const ethercatMemoryKey = (deviceName: string, slaveName: string, channelId: string): string =>
  `ethercat:${deviceName}:${slaveName}:${channelId}`

/** Build a channel seeded (pinned) at a legacy address, or `null` when the
 *  address is not a parseable IEC location (nothing to migrate). */
function seedChannel(
  channelId: string,
  address: string | undefined,
  alias: string | undefined,
  memoryKey: string,
): RegistryChannel | null {
  if (!address) return null
  const parsed = parseAddress(address)
  if (!parsed) return null
  const cls: AddressClass = parsed.cls
  const channel: RegistryChannel = { channelId, class: cls, pinned: address, memoryKey }
  if (alias && alias.length > 0) channel.alias = alias
  return channel
}

/**
 * Build the registry from legacy producer state. Consumers are emitted in a
 * stable order (pins → VPP slots → Modbus groups → EtherCAT slaves) matching
 * the historical reservation order. Addresses are reproduced exactly.
 */
export function migrateToRegistry(inputs: PoolInputs): IecAddressRegistry {
  const consumers: RegistryConsumer[] = []
  let order = 0

  // 1. Pin mapping — one consumer, one channel per pin (fixed hardware).
  const pinChannels: RegistryChannel[] = []
  for (const pin of inputs.pinMapping?.pins ?? []) {
    // Pins are fixed hardware — the address itself is the stable identity.
    const channel = seedChannel(pin.address, pin.address, pin.alias, `pin:${pin.address}`)
    if (channel) pinChannels.push(channel)
  }
  if (pinChannels.length > 0) {
    consumers.push({ id: PIN_MAPPING_KIND, kind: PIN_MAPPING_KIND, order: order++, channels: pinChannels })
  }

  // 2. VPP I/O — one consumer per slot; channels keyed by channel name.
  const bySlot = new Map<number, RegistryChannel[]>()
  for (const entry of inputs.vendorIoMapping?.entries ?? []) {
    const channel = seedChannel(
      entry.channelName,
      entry.iecAddress,
      entry.alias,
      vppMemoryKey(entry.moduleId ?? '', entry.slot, entry.channelName),
    )
    if (!channel) continue
    const list = bySlot.get(entry.slot)
    if (list) list.push(channel)
    else bySlot.set(entry.slot, [channel])
  }
  for (const slot of [...bySlot.keys()].sort((a, b) => a - b)) {
    consumers.push({
      id: `vpp-slot-${slot}`,
      kind: 'vpp-io',
      label: `Slot ${slot}`,
      order: order++,
      channels: bySlot.get(slot)!,
    })
  }

  // 3. Modbus TCP remote — one consumer per IO group.
  for (const device of inputs.remoteDevices ?? []) {
    const deviceName = device.deviceName || device.name || 'device'
    const groups = device.modbusTcpConfig?.ioGroups ?? []
    for (let g = 0; g < groups.length; g++) {
      const group = groups[g]
      const groupId = group.id ?? String(g)
      const channels: RegistryChannel[] = []
      for (const point of group.ioPoints ?? []) {
        const channel = seedChannel(
          point.id,
          point.iecLocation,
          point.alias,
          modbusMemoryKey(deviceName, groupId, point.id),
        )
        if (channel) channels.push(channel)
      }
      if (channels.length > 0) {
        consumers.push({
          id: modbusConsumerId(deviceName, groupId),
          kind: 'modbus-tcp-remote',
          label: `${deviceName} / ${groupId}`,
          order: order++,
          channels,
        })
      }
    }
  }

  // 4. EtherCAT — one consumer per slave device.
  for (const device of inputs.remoteDevices ?? []) {
    const deviceName = device.deviceName || device.name || 'device'
    for (const slave of device.ethercatConfig?.devices ?? []) {
      const slaveName = slave.name || 'slave'
      const channels: RegistryChannel[] = []
      for (const mapping of slave.channelMappings ?? []) {
        const channel = seedChannel(
          mapping.channelId,
          mapping.iecLocation,
          mapping.alias,
          ethercatMemoryKey(deviceName, slaveName, mapping.channelId),
        )
        if (channel) channels.push(channel)
      }
      if (channels.length > 0) {
        consumers.push({
          id: ethercatConsumerId(deviceName, slaveName),
          kind: 'ethercat',
          label: `${deviceName} / ${slaveName}`,
          order: order++,
          channels,
        })
      }
    }
  }

  // Reproduce the legacy addresses exactly (all channels are pinned).
  return recalculate({ consumers, assignments: {} }).registry
}

/**
 * Release the migration seeds so a subsequent `recalculate` can compact.
 *
 * By default every channel EXCEPT real hardware pins (`pin-mapping`) is
 * unpinned. Pass `onlyKinds` to unpin just those consumer kinds and keep
 * everything else pinned — used when reallocating a subset of producers
 * (e.g. only remote devices) while treating pins and VPP as fixed
 * constraints managed by their own allocators. Pure.
 */
export function unpinAllocatableChannels(
  registry: IecAddressRegistry,
  onlyKinds?: ReadonlySet<string>,
): IecAddressRegistry {
  const shouldUnpin = (kind: string): boolean => (onlyKinds ? onlyKinds.has(kind) : kind !== PIN_MAPPING_KIND)
  const consumers = registry.consumers.map((consumer) => {
    if (!shouldUnpin(consumer.kind)) return consumer
    return {
      ...consumer,
      channels: consumer.channels.map((channel) => {
        if (channel.pinned === undefined) return channel
        const { pinned: _pinned, ...rest } = channel
        return rest
      }),
    }
  })
  return { ...registry, consumers }
}

/**
 * Full project-wide recalculation from live producer state. This is the
 * single entry point the store's `recalculateIecAddresses` action drives:
 *
 *   1. derive the consumer structure + aliases from the current producers
 *      (`migrateToRegistry` — everything seeded at its present address),
 *   2. release the seeds on allocatable channels (`unpinAllocatableChannels`
 *      keeps only real hardware pins fixed),
 *   3. re-allocate, capability-scoped, so freed slots are reclaimed and
 *      inactive-kind producers drop out.
 *
 * The result is the fresh registry (gapless, target-scoped) plus any
 * pinned-address conflicts. Aliases ride along on their channels, so the
 * caller's variable reconciliation makes program variables follow.
 */
export function recalculateFromLegacy(
  inputs: PoolInputs,
  options: AllocateOptions = {},
): { registry: IecAddressRegistry; conflicts: AddressConflict[] } {
  const seeded = migrateToRegistry(inputs)
  const unpinned = unpinAllocatableChannels(seeded)
  return recalculate(unpinned, options)
}
