import * as Tabs from '@radix-ui/react-tabs'
import { collectUsedIecAddresses } from '@root/backend/shared/ethercat'
import { useDeviceConfiguration } from '@root/frontend/hooks/use-device-configuration'
import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import type {
  ConfiguredEtherCATDevice,
  EnrichDeviceData,
  ESIDeviceSummary,
  ESIRepositoryItemLight,
  EtherCATChannelMapping,
  EtherCATSlaveConfig,
  SDOConfigurationEntry,
} from '@root/middleware/shared/ports/esi-types'
import { useEsi } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  ChannelMappingsSection,
  DeviceConfigurationForm,
  SdoParametersSection,
} from './components/device-configuration-form'

type DeviceDetailTab = 'info' | 'configuration' | 'startup-params' | 'channel-mappings'

const TabItem = ({ value, label, isActive }: { value: string; label: string; isActive: boolean }) => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'px-4 py-2 font-caption !text-xs font-medium transition-colors',
      'border-b-2 border-transparent',
      'hover:text-brand-medium dark:hover:text-brand-light',
      isActive
        ? 'border-brand-medium text-brand-medium dark:border-brand-light dark:text-brand-light'
        : 'text-neutral-500 dark:text-neutral-400',
    )}
  >
    {label}
  </Tabs.Trigger>
)

/**
 * Standalone full-page editor for a single EtherCAT slave device.
 *
 * Opened when the user clicks on a device child node in the project tree.
 * Reads `busName` and `deviceId` from the editor meta and looks up the
 * device from the Zustand store.
 */
const EtherCATDeviceEditor = () => {
  const { editor, project, projectActions, workspaceActions } = useOpenPLCStore()
  const esi = useEsi()

  const busName = editor.type === 'plc-ethercat-device' ? editor.meta.busName : ''
  const deviceId = editor.type === 'plc-ethercat-device' ? editor.meta.deviceId : ''
  const projectPath = project.meta.path

  const [activeTab, setActiveTab] = useState<DeviceDetailTab>('info')

  // Repository state
  const [repository, setRepository] = useState<ESIRepositoryItemLight[]>([])
  const repositoryLoadedRef = useRef(false)

  // Look up the remote device (bus) and the specific configured device
  const remoteDevice = useMemo(() => {
    return project.data.remoteDevices?.find((d) => d.name === busName)
  }, [project.data.remoteDevices, busName])

  const configuredDevices = useMemo(() => {
    return (remoteDevice?.ethercatConfig?.devices ?? []) as unknown as ConfiguredEtherCATDevice[]
  }, [remoteDevice])

  const device = useMemo(() => {
    return configuredDevices.find((d) => d.id === deviceId) ?? null
  }, [configuredDevices, deviceId])

  const masterConfig = useMemo(() => {
    return (
      remoteDevice?.ethercatConfig?.masterConfig ?? {
        networkInterface: 'eth0',
        cycleTimeUs: 1000,
        watchdogTimeoutCycles: 3,
      }
    )
  }, [remoteDevice])

  // Collect all IEC addresses used across all remote devices
  const usedAddresses = useMemo(() => collectUsedIecAddresses(project.data.remoteDevices), [project.data.remoteDevices])

  // Exclude the current device's own addresses from the "external" set
  const externalAddresses = useMemo(() => {
    if (!device) return usedAddresses
    const filtered = new Set(usedAddresses)
    for (const mapping of device.channelMappings) {
      filtered.delete(mapping.iecLocation)
    }
    return filtered
  }, [usedAddresses, device])

  // Sync helpers
  const deviceName = device?.name ?? ''

  const syncDevicesToStore = useCallback(
    (devices: ConfiguredEtherCATDevice[]) => {
      projectActions.updateEthercatConfig(busName, { masterConfig, devices })
      // Mark the slave file dirty (same pattern as other file types)
      const { sharedWorkspaceActions } = useOpenPLCStore.getState()
      if (deviceName) {
        sharedWorkspaceActions.handleFileAndWorkspaceSavedState(deviceName)
      } else {
        workspaceActions.setEditingState('unsaved')
      }
    },
    [busName, projectActions, masterConfig, deviceName],
  )

  const handleUpdateDevice = useCallback(
    (config: EtherCATSlaveConfig) => {
      syncDevicesToStore(configuredDevices.map((d) => (d.id === deviceId ? { ...d, config } : d)))
    },
    [configuredDevices, deviceId, syncDevicesToStore],
  )

  const handleUpdateChannelMappings = useCallback(
    (channelMappings: EtherCATChannelMapping[]) => {
      syncDevicesToStore(configuredDevices.map((d) => (d.id === deviceId ? { ...d, channelMappings } : d)))
    },
    [configuredDevices, deviceId, syncDevicesToStore],
  )

  const handleEnrichDevice = useCallback(
    (data: EnrichDeviceData) => {
      syncDevicesToStore(configuredDevices.map((d) => (d.id === deviceId ? { ...d, ...data } : d)))
    },
    [configuredDevices, deviceId, syncDevicesToStore],
  )

  const handleUpdateSdoConfigurations = useCallback(
    (sdoConfigurations: SDOConfigurationEntry[]) => {
      syncDevicesToStore(configuredDevices.map((d) => (d.id === deviceId ? { ...d, sdoConfigurations } : d)))
    },
    [configuredDevices, deviceId, syncDevicesToStore],
  )

  // Load ESI repository
  useEffect(() => {
    let cancelled = false

    const loadRepository = async () => {
      if (!projectPath || repositoryLoadedRef.current) return

      try {
        const result = await esi!.loadRepositoryLight()
        if (cancelled) return

        if (result.success && result.items) {
          setRepository(result.items)
          repositoryLoadedRef.current = true
        } else if ('needsMigration' in result && result.needsMigration) {
          const migrationResult = await esi!.migrateRepository()
          if (cancelled) return
          if (migrationResult.success && migrationResult.items) {
            setRepository(migrationResult.items)
            repositoryLoadedRef.current = true
          }
        } else {
          repositoryLoadedRef.current = true
        }
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load ESI repository:', error)
      }
    }

    void loadRepository()
    return () => {
      cancelled = true
    }
  }, [projectPath])

  // Reset repository loaded flag when project changes
  useEffect(() => {
    repositoryLoadedRef.current = false
  }, [projectPath])

  // Resolve ESI device summary and repo item for info display
  const esiDevice = useMemo<ESIDeviceSummary | null>(() => {
    if (!device) return null
    const repoItem = repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId)
    if (!repoItem) return null
    return repoItem.devices[device.esiDeviceRef.deviceIndex] || null
  }, [repository, device])

  const repoItem = useMemo(() => {
    if (!device) return null
    return repository.find((r) => r.id === device.esiDeviceRef.repositoryItemId) ?? null
  }, [repository, device])

  // Use the device configuration hook for channels, CoE objects, etc.
  const { channels, coeObjects, isLoadingChannels, channelLoadError, handleAliasChange, updateConfig } =
    useDeviceConfiguration({
      device: device as ConfiguredEtherCATDevice,
      projectPath,
      externalAddresses,
      onUpdateDevice: handleUpdateDevice,
      onUpdateChannelMappings: handleUpdateChannelMappings,
      onEnrichDevice: handleEnrichDevice,
      enabled: device !== null,
    })

  // Fallback when device is not found
  if (!device) {
    return (
      <div aria-label='EtherCAT device editor container' className='flex h-full w-full items-center justify-center p-4'>
        <div className='text-center'>
          <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>Device not found</h2>
          <p className='mt-2 text-sm text-neutral-600 dark:text-neutral-400'>
            The EtherCAT device could not be found. It may have been removed from the bus configuration.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div aria-label='EtherCAT device editor container' className='flex h-full w-full flex-col overflow-hidden p-4'>
      {/* Header */}
      <div className='mb-4 shrink-0'>
        <h2 className='text-lg font-semibold text-neutral-1000 dark:text-neutral-100'>{device.name}</h2>
      </div>

      {/* Tabs */}
      <Tabs.Root
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as DeviceDetailTab)}
        className='flex min-h-0 flex-1 flex-col overflow-hidden'
      >
        <Tabs.List className='flex shrink-0 border-b border-neutral-200 dark:border-neutral-700'>
          <TabItem value='info' label='Device Info' isActive={activeTab === 'info'} />
          <TabItem value='configuration' label='Configuration' isActive={activeTab === 'configuration'} />
          <TabItem value='startup-params' label='Startup Parameters' isActive={activeTab === 'startup-params'} />
          <TabItem value='channel-mappings' label='Channel Mappings' isActive={activeTab === 'channel-mappings'} />
        </Tabs.List>

        {/* Device Info Tab */}
        <Tabs.Content
          value='info'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <div className='grid grid-cols-2 gap-x-6 gap-y-3 text-xs'>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Vendor</span>
                <span className='text-neutral-700 dark:text-neutral-300'>{repoItem?.vendor.name || 'Unknown'}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Vendor ID</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.vendorId}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Product Code</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.productCode}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>Revision</span>
                <span className='font-mono text-neutral-700 dark:text-neutral-300'>{device.revisionNo}</span>
              </div>
              <div className='flex flex-col gap-0.5'>
                <span className='font-medium text-neutral-500 dark:text-neutral-400'>ESI File</span>
                <span className='text-neutral-700 dark:text-neutral-300'>{repoItem?.filename || 'Not found'}</span>
              </div>
              {esiDevice?.groupName && (
                <div className='flex flex-col gap-0.5'>
                  <span className='font-medium text-neutral-500 dark:text-neutral-400'>Group</span>
                  <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.groupName}</span>
                </div>
              )}
              {esiDevice && (
                <>
                  <div className='flex flex-col gap-0.5'>
                    <span className='font-medium text-neutral-500 dark:text-neutral-400'>Input Channels</span>
                    <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.inputChannelCount}</span>
                  </div>
                  <div className='flex flex-col gap-0.5'>
                    <span className='font-medium text-neutral-500 dark:text-neutral-400'>Output Channels</span>
                    <span className='text-neutral-700 dark:text-neutral-300'>{esiDevice.outputChannelCount}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </Tabs.Content>

        {/* Configuration Tab */}
        <Tabs.Content
          value='configuration'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex-1 overflow-auto p-4'>
            <div className='flex flex-col gap-5'>
              <DeviceConfigurationForm config={device.config} updateConfig={updateConfig} />
            </div>
          </div>
        </Tabs.Content>

        {/* Startup Parameters Tab */}
        <Tabs.Content
          value='startup-params'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex min-h-0 flex-1 flex-col overflow-auto p-4'>
            <SdoParametersSection
              isLoading={isLoadingChannels}
              loadError={channelLoadError}
              sdoConfigurations={device.sdoConfigurations}
              coeObjects={coeObjects}
              onUpdateSdoConfigurations={handleUpdateSdoConfigurations}
            />
          </div>
        </Tabs.Content>

        {/* Channel Mappings Tab */}
        <Tabs.Content
          value='channel-mappings'
          className='flex min-h-0 flex-1 flex-col overflow-hidden data-[state=inactive]:hidden'
        >
          <div className='flex min-h-0 flex-1 flex-col overflow-auto p-4'>
            <ChannelMappingsSection
              isLoading={isLoadingChannels}
              loadError={channelLoadError}
              channels={channels}
              mappings={device.channelMappings}
              onAliasChange={handleAliasChange}
            />
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

export { EtherCATDeviceEditor }
