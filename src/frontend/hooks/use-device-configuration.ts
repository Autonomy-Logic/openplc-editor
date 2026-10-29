import {
  enrichDeviceData,
  esiStartupData,
  lacksEsiStartupData,
  lacksPdoAssignment,
  lacksPdoFlags,
  migrateSlavePdoFlags,
  recordPdoAssignment,
} from '@root/backend/shared/ethercat/enrich-device-data'
import { generateDefaultChannelMappings, pdoToChannels } from '@root/backend/shared/ethercat/esi-parser'
import { extractDefaultSdoConfigurations } from '@root/backend/shared/ethercat/sdo-config-defaults'
import { toast } from '@root/frontend/components/_features/[app]/toast/use-toast'
import { useOpenPLCStoreApi } from '@root/frontend/store'
import type {
  ConfiguredEtherCATDevice,
  ConfiguredEtherCATModule,
  EnrichDeviceData,
  ESIAlternativeSmMapping,
  ESIChannel,
  ESICoEObject,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  PersistedChannelInfo,
} from '@root/middleware/shared/ports/esi-types'
import { useEsi } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useEthercatAliasEdit } from './use-ethercat-alias-edit'

type UseDeviceConfigurationParams = {
  device: ConfiguredEtherCATDevice | null
  projectPath: string
  externalAddresses: Set<string>
  onUpdateDevice: (config: EtherCATSlaveConfig) => void
  onUpdateChannelMappings: (mappings: EtherCATChannelMapping[]) => void
  onEnrichDevice: (data: EnrichDeviceData) => void
  /** Called when an alias edit targets a channel that belongs to a module slotted
   *  into a modular coupler. The hook rebuilds the module's channelMappings and
   *  hands the whole module back; callers persist it via the project store. */
  onUpdateModule?: (moduleId: string, module: ConfiguredEtherCATModule) => void
  enabled?: boolean
}

type UseDeviceConfigurationResult = {
  channels: ESIChannel[]
  channelMappings: EtherCATChannelMapping[]
  coeObjects: ESICoEObject[] | undefined
  alternativeSmMappings: ESIAlternativeSmMapping[] | undefined
  isLoadingChannels: boolean
  channelLoadError: string | null
  handleAliasChange: (channelId: string, alias: string) => void
  updateConfig: <K extends keyof EtherCATSlaveConfig>(section: K, updates: Partial<EtherCATSlaveConfig[K]>) => void
}

/** Build ESIChannel rows the shared ChannelMappingTable expects, from persisted
 *  channelInfo. Fields the table does not read (pdoName, bitOffset, byteOffset)
 *  are filled with safe defaults. Mirrored from the standalone module editor. */
function synthesizeChannels(channelInfo: PersistedChannelInfo[] | undefined): ESIChannel[] {
  return (channelInfo ?? []).map((ci) => ({
    id: ci.channelId,
    direction: ci.direction,
    pdoIndex: ci.pdoIndex,
    pdoName: '',
    entryIndex: ci.entryIndex,
    entrySubIndex: ci.entrySubIndex,
    name: ci.name,
    dataType: ci.dataType,
    bitLen: ci.bitLen,
    bitOffset: 0,
    byteOffset: 0,
    iecType: ci.iecType,
  }))
}

type ChannelOwner = { kind: 'device' } | { kind: 'module'; moduleId: string; module: ConfiguredEtherCATModule }

export function useDeviceConfiguration({
  device,
  projectPath,
  externalAddresses,
  onUpdateDevice,
  onUpdateChannelMappings,
  onEnrichDevice,
  onUpdateModule,
  enabled = true,
}: UseDeviceConfigurationParams): UseDeviceConfigurationResult {
  const store = useOpenPLCStoreApi()
  const commitAliasEdit = useEthercatAliasEdit()
  const esiPort = useEsi()
  const [channels, setChannels] = useState<ESIChannel[]>([])
  const [coeObjects, setCoeObjects] = useState<ESICoEObject[] | undefined>(undefined)
  const [alternativeSmMappings, setAlternativeSmMappings] = useState<ESIAlternativeSmMapping[] | undefined>(undefined)
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
  const onUpdateModuleRef = useRef(onUpdateModule)
  onUpdateModuleRef.current = onUpdateModule

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
          setAlternativeSmMappings(result.device.alternativeSmMappings)
          fullDeviceLoadedRef.current = true

          if (device.channelMappings.length === 0 && deviceChannels.length > 0) {
            onUpdateChannelMappingsRef.current(generateDefaultChannelMappings(deviceChannels, externalAddresses))
          }

          if (!device.channelInfo || !device.rxPdos || !device.txPdos) {
            const { sdoConfigurations, ...rest } = enrichDeviceData(result.device, externalAddresses)
            onEnrichDeviceRef.current(device.sdoConfigurations !== undefined ? rest : { ...rest, sdoConfigurations })
          } else if (lacksPdoFlags(device)) {
            // A slave saved without CoE flags or per-PDO flags gets them from the ESI; its
            // PDO assignment is kept. Idempotent.
            const migrated = migrateSlavePdoFlags(device, result.device)
            onEnrichDeviceRef.current({
              rxPdos: migrated.rxPdos,
              txPdos: migrated.txPdos,
              coeFlags: migrated.config.coeFlags,
            })
            toast({
              title: 'Project updated',
              description:
                'This EtherCAT slave was saved under the previous schema. Its CoE flags and PDO defaults have been filled in from the ESI.',
              variant: 'default',
            })
          } else if (lacksEsiStartupData(device, result.device)) {
            onEnrichDeviceRef.current(esiStartupData(result.device))
          } else if (lacksPdoAssignment(device)) {
            onEnrichDeviceRef.current(recordPdoAssignment(device, result.device))
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

  // On a modular coupler the view lists the coupler's and every module's channels; the owner
  // map routes an alias edit back to the coupler or to the module that owns the channel.
  const { aggregatedChannels, aggregatedMappings, ownerByChannelId } = useMemo(() => {
    const own = new Map<string, ChannelOwner>()
    if (!device?.isModularCoupler) {
      return {
        aggregatedChannels: channels,
        aggregatedMappings: device?.channelMappings ?? [],
        ownerByChannelId: own,
      }
    }
    const chs: ESIChannel[] = []
    const maps: EtherCATChannelMapping[] = []
    const couplerChs = synthesizeChannels(device.channelInfo)
    chs.push(...couplerChs)
    for (const c of couplerChs) own.set(c.id, { kind: 'device' })
    maps.push(...device.channelMappings)
    const sortedModules = [...(device.modules ?? [])].sort((a, b) => a.slot - b.slot)
    for (const m of sortedModules) {
      const modChs = synthesizeChannels(m.channelInfo)
      chs.push(...modChs)
      for (const c of modChs) own.set(c.id, { kind: 'module', moduleId: m.id, module: m })
      maps.push(...m.channelMappings)
    }
    return { aggregatedChannels: chs, aggregatedMappings: maps, ownerByChannelId: own }
  }, [channels, device])

  const handleAliasChange = useCallback(
    (channelId: string, alias: string) => {
      if (!device) return
      const owner = ownerByChannelId.get(channelId) ?? { kind: 'device' as const }
      const busName =
        store
          .getState()
          .project.data.remoteDevices?.find((d) => d.ethercatConfig?.devices?.some((s) => s.name === device.name))
          ?.name ?? ''

      if (owner.kind === 'module') {
        const module = owner.module
        const oldAlias = module.channelMappings.find((m) => m.channelId === channelId)?.alias ?? ''
        const target = { busName, slaveName: device.name, moduleId: module.id, channelId }
        const result = commitAliasEdit(target, oldAlias, alias)
        if (!result.ok) {
          toast({ title: result.title, description: result.description, variant: 'fail' })
          return
        }
        const existing = module.channelMappings.some((m) => m.channelId === channelId)
        const nextMappings = existing
          ? module.channelMappings.map((m) => (m.channelId === channelId ? { ...m, alias } : m))
          : [...module.channelMappings, { channelId, iecLocation: '', alias }]
        onUpdateModuleRef.current?.(module.id, { ...module, channelMappings: nextMappings })
        return
      }

      const oldAlias = device.channelMappings.find((m) => m.channelId === channelId)?.alias ?? ''
      const result = commitAliasEdit({ busName, slaveName: device.name, channelId }, oldAlias, alias)
      if (!result.ok) {
        toast({ title: result.title, description: result.description, variant: 'fail' })
        return
      }
      const updated = device.channelMappings.map((m) => (m.channelId === channelId ? { ...m, alias } : m))
      onUpdateChannelMappingsRef.current(updated)
    },
    [store, device, ownerByChannelId, commitAliasEdit],
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
    channels: aggregatedChannels,
    channelMappings: aggregatedMappings,
    coeObjects,
    alternativeSmMappings,
    isLoadingChannels,
    channelLoadError,
    handleAliasChange,
    updateConfig,
  }
}
