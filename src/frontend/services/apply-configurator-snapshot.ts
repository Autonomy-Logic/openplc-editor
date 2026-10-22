import type { ConfiguratorSnapshot } from '../../middleware/shared/ports/configurator-port'
import type { IoMappingEntry } from '../../middleware/shared/ports/types'
import { buildAddressPool } from '../../middleware/shared/utils/iec-address'
import { resolveAddressProducerCapabilities } from '../../middleware/shared/utils/target-capabilities'
import type { OpenPLCStore } from '../store'
import { allocateModuleSlots, type DroppedAlias } from '../utils/vpp/allocate-module-slots'
import { toDeviceSetupRecord } from '../utils/vpp/device-setup'
import { IO_MAPPING_KEY } from '../utils/vpp/persistence-keys'

export interface ConfiguratorSnapshotTarget {
  configuratorKey: string
  controller: string
  bundleVersion: string
}

export interface AppliedConfiguratorSnapshot {
  dropped: DroppedAlias[]
}

function storedEntries(value: unknown): IoMappingEntry[] {
  if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) return []
  return value.entries.filter((entry): entry is IoMappingEntry => !!entry && typeof entry === 'object')
}

/**
 * Persist a configurator snapshot: the archive untouched, the device setup,
 * the manifest module of each slot (matched by exact `typeId`) and the I/O
 * mapping of those modules. Addresses are then reallocated by the registry.
 */
export function applyConfiguratorSnapshot(
  store: OpenPLCStore,
  target: ConfiguratorSnapshotTarget,
  snapshot: ConfiguratorSnapshot,
): AppliedConfiguratorSnapshot {
  const state = store.getState()
  const { configuration, pinMapping } = state.deviceDefinitions
  const board = state.deviceAvailableOptions.availableBoards.get(configuration.deviceBoard)
  const manifestModules = board?.vpp?.moduleSystem?.modules ?? []
  const pool = buildAddressPool(
    {
      pinMapping: { pins: pinMapping.pinsByBoard[configuration.deviceBoard] ?? [] },
      remoteDevices: state.project.data.remoteDevices ?? [],
    },
    resolveAddressProducerCapabilities(board),
    { ignoreSource: 'vpp-io' },
  )

  const deviceSetup = toDeviceSetupRecord(snapshot.deviceSetup)
  // Exact string compare: an all-digit type id must never be parsed as a number.
  const slots = deviceSetup.modules.map(
    (module) => manifestModules.find((definition) => definition.typeId === module.typeId)?.id ?? null,
  )
  const { entries, dropped } = allocateModuleSlots({
    slots,
    slotsConfig: {},
    modules: manifestModules,
    pool,
    previous: storedEntries(configuration.vendorScreenData?.[IO_MAPPING_KEY]),
  })

  state.deviceActions.setConfiguratorSnapshot(target.configuratorKey, {
    configurator: { archive: snapshot.archive, controller: target.controller, bundleVersion: target.bundleVersion },
    deviceSetup,
    moduleConfiguration: { slots },
    ioMapping: { entries },
  })
  store.getState().projectActions.recalculateIecAddresses()
  return { dropped }
}
