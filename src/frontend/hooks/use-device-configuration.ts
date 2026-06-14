import { enrichDeviceData } from '@root/backend/shared/ethercat/enrich-device-data'
import { generateDefaultChannelMappings, pdoToChannels } from '@root/backend/shared/ethercat/esi-parser'
import { extractDefaultSdoConfigurations } from '@root/backend/shared/ethercat/sdo-config-defaults'
import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { useOpenPLCStore } from '@root/frontend/store'
import type {
  ConfiguredEtherCATDevice,
  EnrichDeviceData,
  ESIChannel,
  ESICoEObject,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
} from '@root/middleware/shared/ports/esi-types'
import { useEsi } from '@root/middleware/shared/providers/platform-context'
import {
  buildAddressPool,
  buildAliasRegistry,
  describeSource,
  validateAliasEdit,
} from '@root/middleware/shared/utils/iec-address'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { useCallback, useEffect, useRef, useState } from 'react'

type UseDeviceConfigurationParams = {
  device: ConfiguredEtherCATDevice
  projectPath: string
  externalAddresses: Set<string>
  onUpdateDevice: (config: EtherCATSlaveConfig) => void
  onUpdateChannelMappings: (mappings: EtherCATChannelMapping[]) => void
  onEnrichDevice: (data: EnrichDeviceData) => void
  enabled?: boolean
}

type UseDeviceConfigurationResult = {
  channels: ESIChannel[]
  coeObjects: ESICoEObject[] | undefined
  isLoadingChannels: boolean
  channelLoadError: string | null
  handleAliasChange: (channelId: string, alias: string) => void
  updateConfig: <K extends keyof EtherCATSlaveConfig>(section: K, updates: Partial<EtherCATSlaveConfig[K]>) => void
}

export function useDeviceConfiguration({
  device,
  projectPath,
  externalAddresses,
  onUpdateDevice,
  onUpdateChannelMappings,
  onEnrichDevice,
  enabled = true,
}: UseDeviceConfigurationParams): UseDeviceConfigurationResult {
  const esiPort = useEsi()
  const [channels, setChannels] = useState<ESIChannel[]>([])
  const [coeObjects, setCoeObjects] = useState<ESICoEObject[] | undefined>(undefined)
  const [isLoadingChannels, setIsLoadingChannels] = useState(false)
  const [channelLoadError, setChannelLoadError] = useState<string | null>(null)
  const fullDeviceLoadedRef = useRef(false)

  // Capture latest callback refs to avoid stale closures and unstable deps
  const onUpdateDeviceRef = useRef(onUpdateDevice)
  onUpdateDeviceRef.current = onUpdateDevice
  const onUpdateChannelMappingsRef = useRef(onUpdateChannelMappings)
  onUpdateChannelMappingsRef.current = onUpdateChannelMappings
  const onEnrichDeviceRef = useRef(onEnrichDevice)
  onEnrichDeviceRef.current = onEnrichDevice

  useEffect(() => {
    if (!enabled || !device || fullDeviceLoadedRef.current) return

    const loadFullDevice = async () => {
      setIsLoadingChannels(true)
      setChannelLoadError(null)

      try {
        const result = await esiPort!.loadDeviceFull(
          device.esiDeviceRef.repositoryItemId,
          device.esiDeviceRef.deviceIndex,
        )

        if (result.success && result.device) {
          const deviceChannels = pdoToChannels(result.device)
          setChannels(deviceChannels)
          setCoeObjects(result.device.coeObjects)
          fullDeviceLoadedRef.current = true

          if (device.channelMappings.length === 0 && deviceChannels.length > 0) {
            onUpdateChannelMappingsRef.current(generateDefaultChannelMappings(deviceChannels, externalAddresses))
          }

          if (!device.channelInfo || !device.rxPdos || !device.txPdos) {
            const { sdoConfigurations, ...rest } = enrichDeviceData(result.device, externalAddresses)
            onEnrichDeviceRef.current(device.sdoConfigurations !== undefined ? rest : { ...rest, sdoConfigurations })
          } else if (device.sdoConfigurations === undefined && result.device.coeObjects?.length) {
            onEnrichDeviceRef.current({
              channelInfo: device.channelInfo,
              rxPdos: device.rxPdos,
              txPdos: device.txPdos,
              slaveType: device.slaveType ?? '',
              sdoConfigurations: extractDefaultSdoConfigurations(result.device.coeObjects),
            })
          }
        } else {
          setChannelLoadError(!result.success ? (result.error ?? 'Failed') : 'Failed to load device data')
        }
      } catch (error) {
        setChannelLoadError(String(error))
      } finally {
        setIsLoadingChannels(false)
      }
    }

    void loadFullDevice()
  }, [enabled, projectPath, device?.esiDeviceRef?.repositoryItemId, device?.esiDeviceRef?.deviceIndex])

  const handleAliasChange = useCallback(
    (channelId: string, alias: string) => {
      if (!device) return

      // Resolve the bus owning this slave so we can construct a
      // `SourceRef` whose `ref` matches the format used by the
      // address pool (`${busName}:${slaveName}:${channelId}` — see
      // `address-pool.ts:243`).  Without this, `validateAliasEdit`'s
      // "ignoring" comparison wouldn't recognise a no-op self-rename
      // and would spuriously reject it.
      const state = useOpenPLCStore.getState()
      const owningBus = state.project.data.remoteDevices?.find((d) =>
        d.ethercatConfig?.devices?.some((s) => s.name === device.name),
      )
      const busName = owningBus?.name ?? ''
      const sourceRef = { kind: 'ethercat' as const, ref: `${busName}:${device.name}:${channelId}` }

      // Phase 1 — write-time uniqueness gate (global across all
      // producers).  Build a fresh registry from the live state and
      // reject the edit on collision.  See
      // `module-slots-layout.tsx::handleAliasChange` for the longer
      // rationale.
      const board = state.deviceDefinitions.configuration.deviceBoard ?? ''
      const boardInfo = state.deviceAvailableOptions.availableBoards.get(board)
      const ioMapping =
        (
          state.deviceDefinitions.configuration.vendorScreenData?.['io-mapping'] as
            | { entries?: Array<{ iecAddress: string; alias?: string; slot: number; channelName: string }> }
            | undefined
        )?.entries ?? []
      const pool = buildAddressPool(
        {
          pinMapping: { pins: state.deviceDefinitions.pinMapping.pinsByBoard[board] ?? [] },
          vendorIoMapping: { entries: ioMapping },
          remoteDevices: state.project.data.remoteDevices,
        },
        resolveTargetCapabilities(boardInfo),
      )
      const registry = buildAliasRegistry(pool)
      const validation = validateAliasEdit(registry, alias, sourceRef)
      if (!validation.ok) {
        toast({
          title: 'Alias already in use',
          description: `"${alias}" is already assigned to ${describeSource(validation.conflict.source)} (${validation.conflict.address}). Alias names must be unique across all I/O channels.`,
          variant: 'fail',
        })
        return
      }

      // Phase 2 — cascade rename onto bound variables BEFORE
      // writing the new alias so the downstream sync sees variables
      // pointing at the new name and refreshes locations rather
      // than orphaning them.
      const oldAlias = device.channelMappings.find((m) => m.channelId === channelId)?.alias ?? ''
      if (oldAlias) {
        useOpenPLCStore.getState().projectActions.renameAlias(oldAlias, alias)
      }

      const updated = device.channelMappings.map((m) => (m.channelId === channelId ? { ...m, alias } : m))
      onUpdateChannelMappingsRef.current(updated)
    },
    [device?.channelMappings, device?.name],
  )

  const updateConfig = useCallback(
    <K extends keyof EtherCATSlaveConfig>(section: K, updates: Partial<EtherCATSlaveConfig[K]>) => {
      if (!device) return
      onUpdateDeviceRef.current({
        ...device.config,
        [section]: { ...device.config[section], ...updates },
      })
    },
    [device?.config],
  )

  return {
    channels,
    coeObjects,
    isLoadingChannels,
    channelLoadError,
    handleAliasChange,
    updateConfig,
  }
}
