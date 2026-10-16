import { useOpenPLCStoreApi } from '@root/frontend/store'
import {
  buildAddressPool,
  buildAliasRegistry,
  describeAliasRejection,
  validateAliasEdit,
} from '@root/middleware/shared/utils/iec-address'
import { resolveAddressProducerCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useCallback } from 'react'

/** The EtherCAT channel an alias belongs to: a slave channel, or a module channel when `moduleId` is set. */
export interface EthercatAliasTarget {
  busName: string
  slaveName: string
  moduleId?: string
  channelId: string
}

/** Outcome of an alias edit; a refusal carries the title and description to show the user. */
export type EthercatAliasEditResult = { ok: true } | { ok: false; title: string; description: string }

type IoMappingEntry = { iecAddress: string; alias?: string; slot: number; channelName: string }

const isIoMappingEntry = (v: unknown): v is IoMappingEntry =>
  typeof v === 'object' &&
  v !== null &&
  'iecAddress' in v &&
  typeof v.iecAddress === 'string' &&
  'slot' in v &&
  typeof v.slot === 'number' &&
  'channelName' in v &&
  typeof v.channelName === 'string'

const ioMappingEntries = (screen: unknown): IoMappingEntry[] => {
  if (typeof screen !== 'object' || screen === null || !('entries' in screen) || !Array.isArray(screen.entries)) {
    return []
  }
  return screen.entries.filter(isIoMappingEntry)
}

/**
 * Gate for an alias edit on an EtherCAT channel: the alias must be unique across every
 * producer in the project. On success the old alias is renamed on every variable bound to it,
 * and the caller writes the new alias. On refusal nothing changes and the result says why.
 */
export function useEthercatAliasEdit(): (
  target: EthercatAliasTarget,
  oldAlias: string,
  alias: string,
) => EthercatAliasEditResult {
  const store = useOpenPLCStoreApi()
  return useCallback(
    (target, oldAlias, alias) => {
      const state = store.getState()
      const ref =
        target.moduleId === undefined
          ? `${target.busName}:${target.slaveName}:${target.channelId}`
          : `${target.busName}:${target.slaveName}:${target.moduleId}:${target.channelId}`
      const board = state.deviceDefinitions.configuration.deviceBoard ?? ''
      const pool = buildAddressPool(
        {
          pinMapping: { pins: state.deviceDefinitions.pinMapping.pinsByBoard[board] ?? [] },
          vendorIoMapping: {
            entries: ioMappingEntries(state.deviceDefinitions.configuration.vendorScreenData?.['io-mapping']),
          },
          remoteDevices: state.project.data.remoteDevices,
        },
        resolveAddressProducerCapabilities(state.deviceAvailableOptions.availableBoards.get(board)),
      )
      const validation = validateAliasEdit(buildAliasRegistry(pool), alias, { kind: 'ethercat', ref })
      if (!validation.ok) {
        return { ok: false, ...describeAliasRejection(validation, alias) }
      }
      // Rename bound variables before the new alias is written, so they follow it instead of
      // becoming orphaned.
      if (oldAlias !== '' && oldAlias !== alias) state.projectActions.renameAlias(oldAlias, alias)
      return { ok: true }
    },
    [store],
  )
}
