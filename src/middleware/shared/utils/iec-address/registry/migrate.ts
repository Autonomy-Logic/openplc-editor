import { runsModbusMaster } from '../../target-capabilities/modbus-master'
import type { AddressProducerCapabilities } from '../../target-capabilities/types'
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

/** The consumer kinds a target's capabilities keep active in allocation. */
export function activeKindsFor(caps: AddressProducerCapabilities): Set<string> {
  const kinds = new Set<string>()
  if (caps.pinMapping) kinds.add(PIN_MAPPING_KIND)
  if (caps.vppIo) kinds.add('vpp-io')
  if (runsModbusMaster(caps)) kinds.add('modbus-tcp-remote')
  if (caps.ethercat) kinds.add('ethercat')
  return kinds
}

/* Consumer-id builders. */
export const modbusConsumerId = (deviceName: string, groupId: string): string => `modbus:${deviceName}:${groupId}`
export const ethercatConsumerId = (deviceName: string, slaveName: string): string =>
  `ethercat:${deviceName}:${slaveName}`

/* Session alias-memory key builders. */
export const vppMemoryKey = (moduleId: string, slot: number, channelName: string): string =>
  `vpp:${moduleId}:${slot}:${channelName}`
export const modbusMemoryKey = (deviceName: string, groupId: string, pointId: string): string =>
  `modbus:${deviceName}:${groupId}:${pointId}`
export const ethercatMemoryKey = (deviceName: string, slaveName: string, channelId: string): string =>
  `ethercat:${deviceName}:${slaveName}:${channelId}`
/** Memory key for a channel that belongs to a module plugged into a modular
 *  coupler, carrying the module's slot id so the key stays stable across
 *  slave reorderings and across channelId reuse between coupler and module. */
export const ethercatModuleMemoryKey = (
  deviceName: string,
  slaveName: string,
  moduleId: string,
  channelId: string,
): string => `ethercat:${deviceName}:${slaveName}:${moduleId}:${channelId}`

/** Separator used to build a registry channel id that disambiguates a module
 *  channel from a coupler-level channel with the same PDO identifier. The
 *  `#` character never appears in a legitimate channel id, so splitting on it
 *  is a safe inverse at write-back time. */
export const MODULE_REGISTRY_CHANNEL_PREFIX = '#'
export const moduleRegistryChannelId = (moduleId: string, channelId: string): string =>
  `${moduleId}${MODULE_REGISTRY_CHANNEL_PREFIX}${channelId}`
export function parseModuleRegistryChannelId(
  registryChannelId: string,
): { moduleId: string; channelId: string } | null {
  const idx = registryChannelId.indexOf(MODULE_REGISTRY_CHANNEL_PREFIX)
  if (idx <= 0 || idx === registryChannelId.length - 1) return null
  return { moduleId: registryChannelId.slice(0, idx), channelId: registryChannelId.slice(idx + 1) }
}

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

/** Build the registry from legacy producer state. */
export function migrateToRegistry(inputs: PoolInputs): IecAddressRegistry {
  const consumers: RegistryConsumer[] = []
  let order = 0

  const pinChannels: RegistryChannel[] = []
  for (const pin of inputs.pinMapping?.pins ?? []) {
    const channel = seedChannel(pin.address, pin.address, pin.alias, `pin:${pin.address}`)
    if (channel) pinChannels.push(channel)
  }
  if (pinChannels.length > 0) {
    consumers.push({ id: PIN_MAPPING_KIND, kind: PIN_MAPPING_KIND, order: order++, channels: pinChannels })
  }

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
      for (const module of slave.modules ?? []) {
        const moduleId = module.id ?? `slot-${module.slot ?? 'unknown'}`
        for (const mapping of module.channelMappings ?? []) {
          const channel = seedChannel(
            moduleRegistryChannelId(moduleId, mapping.channelId),
            mapping.iecLocation,
            mapping.alias,
            ethercatModuleMemoryKey(deviceName, slaveName, moduleId, mapping.channelId),
          )
          if (channel) channels.push(channel)
        }
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
