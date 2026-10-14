import type { ConfiguratorSnapshot } from '../../middleware/shared/ports/configurator-port'
import type { IoMappingEntry } from '../../middleware/shared/ports/types'
import { buildAddressPool } from '../../middleware/shared/utils/iec-address'
import { resolveTargetCapabilities } from '../../middleware/shared/utils/target-capabilities'
import type { OpenPLCStore } from '../store'
import {
  datapointsToIoMapping,
  type DroppedAlias,
  restoreAliasesByDatapointId,
  toDeviceSetupRecord,
  type UnaddressableDataPoint,
} from '../utils/vpp/datapoints-to-io-mapping'
import { IO_MAPPING_KEY } from '../utils/vpp/persistence-keys'

export interface ConfiguratorSnapshotTarget {
  configuratorKey: string
  controller: string
  bundleVersion: string
}

export interface AppliedConfiguratorSnapshot {
  dropped: DroppedAlias[]
  unaddressable: UnaddressableDataPoint[]
}

function storedEntries(value: unknown): IoMappingEntry[] {
  if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) return []
  return value.entries.filter((entry): entry is IoMappingEntry => !!entry && typeof entry === 'object')
}

/**
 * Persist a configurator snapshot: the archive untouched, the device setup, and
 * the I/O mapping derived from the datapoints with aliases carried over by
 * datapoint id. Addresses are then reallocated by the registry.
 */
export function applyConfiguratorSnapshot(
  store: OpenPLCStore,
  target: ConfiguratorSnapshotTarget,
  snapshot: ConfiguratorSnapshot,
): AppliedConfiguratorSnapshot {
  const state = store.getState()
  const { configuration, pinMapping } = state.deviceDefinitions
  const previous = storedEntries(configuration.vendorScreenData?.[IO_MAPPING_KEY])
  const capabilities = resolveTargetCapabilities(
    state.deviceAvailableOptions.availableBoards.get(configuration.deviceBoard),
  )
  const pool = buildAddressPool(
    {
      pinMapping: { pins: pinMapping.pinsByBoard[configuration.deviceBoard] ?? [] },
      remoteDevices: state.project.data.remoteDevices ?? [],
    },
    capabilities,
    { ignoreSource: 'vpp-io' },
  )

  const deviceSetup = toDeviceSetupRecord(snapshot.deviceSetup)
  const { entries, unaddressable } = datapointsToIoMapping(snapshot.dataPoints, deviceSetup, pool)
  const restored = restoreAliasesByDatapointId(previous, entries)

  state.deviceActions.setConfiguratorSnapshot(target.configuratorKey, {
    configurator: { archive: snapshot.archive, controller: target.controller, bundleVersion: target.bundleVersion },
    deviceSetup,
    ioMapping: { entries: restored.entries },
  })
  store.getState().projectActions.recalculateIecAddresses()
  return { dropped: restored.dropped, unaddressable }
}
