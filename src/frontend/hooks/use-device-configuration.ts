import type {
  ConfiguredEtherCATDevice,
  EnrichDeviceData,
  ESIChannel,
  ESICoEObject,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
} from '@root/middleware/shared/ports/esi-types'
import { enrichDeviceData } from '@root/backend/shared/ethercat/enrich-device-data'
import { generateDefaultChannelMappings, pdoToChannels } from '@root/backend/shared/ethercat/esi-parser'
import { extractDefaultSdoConfigurations } from '@root/backend/shared/ethercat/sdo-config-defaults'
import { useEsi } from '@root/middleware/shared/providers/platform-context'
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
            const { sdoConfigurations, ...rest } = enrichDeviceData(result.device)
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
      const updated = device.channelMappings.map((m) => (m.channelId === channelId ? { ...m, alias } : m))
      onUpdateChannelMappingsRef.current(updated)
    },
    [device?.channelMappings],
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
